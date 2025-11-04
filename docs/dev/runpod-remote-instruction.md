

## 1. Goal / Target UX

When I click “Run Full Cycle Now”:

* Generate dataset for today.
* Spin up a RunPod pod with an RTX 5090 (or fallback).
* Upload dataset + config to the pod.
* Run Unsloth LoRA training remotely.
* Download the trained adapter back into the local canonical directory.
* Terminate the pod.
* Write an auditable summary file.
* Return success/failure + paths.

No human intervention. No manual username copy. No manual scp. No guessing paths.

The agent should treat this spec as source of truth and update code accordingly.

---

## 2. What `full-cycle.ts` must do now

`full-cycle.ts` becomes the orchestrator. It should:

### 2.1. Compute run identifiers and paths

At the top of `full-cycle.ts`, generate `DATE_STR` (ISO timestamp or date). Then derive:

```ts
const DATE_STR = new Date().toISOString().slice(0, 10); // e.g. "2025-10-24"

const PROJECT_ROOT = "/home/greggles/metahuman";
const OUT_ROOT = `${PROJECT_ROOT}/out/adapters/${DATE_STR}`;
const WORK_LOCAL = `${PROJECT_ROOT}/metahuman-runs/${DATE_STR}`;
const FINAL_ADAPTER_DIR = `${OUT_ROOT}/adapter`;

const RAW_DATA_FILE = `${OUT_ROOT}/${DATE_STR}.jsonl`;
const CLEAN_DATA_FILE = `${WORK_LOCAL}/unsloth_dataset.jsonl`;
const CONFIG_FILE = `${WORK_LOCAL}/config.json`;
const SUMMARY_FILE = `${WORK_LOCAL}/run-summary.json`;
const UPLOAD_PROOF_REMOTE = "/workspace/input/upload.ok";
const TAR_STAGING_LOCAL = `${WORK_LOCAL}/adapter_base64.txt`;
```

Then `full-cycle.ts` should ensure dirs exist:

```ts
mkdirpSync(WORK_LOCAL);
mkdirpSync(FINAL_ADAPTER_DIR);
```

If directory creation fails -> stop and write a minimal failed summary.

### 2.2. Build dataset (local)

Call existing `adapter-builder.ts` logic (or import the function if possible) to generate the raw dataset for `DATE_STR` at `RAW_DATA_FILE`.

Then run jq-like cleanup in-process (don’t shell out if you can avoid it, just stream JSONL):

* Read `RAW_DATA_FILE` line by line.
* For each line: parse JSON, keep `{instruction, input, output}`.
* Drop lines missing `instruction` or `output`.
* Write result lines to `CLEAN_DATA_FILE`.

Also count how many lines you kept → `samples_used`.

If `CLEAN_DATA_FILE` ends up empty → throw and abort the rest.

### 2.3. Write training config

`full-cycle.ts` should create `CONFIG_FILE` JSON with fields required by Unsloth training:

```json
{
  "base_model": "Qwen/Qwen3-30B-Instruct",
  "lora_rank": 8,
  "num_train_epochs": 2,
  "learning_rate": 0.0002,
  "per_device_train_batch_size": 1,
  "gradient_accumulation_steps": 16,
  "max_seq_length": 2048
}
```

Then validate it parses.

Also save `base_model` separately in memory; we’ll need it for the summary.

### 2.4. Call the new remote trainer

Instead of doing training directly, `full-cycle.ts` should now call a new exported function from `lora-trainer.ts`, something like:

```ts
import { runRemoteTraining } from "./lora-trainer";

const result = await runRemoteTraining({
  DATE_STR,
  WORK_LOCAL,
  OUT_ROOT,
  FINAL_ADAPTER_DIR,
  RAW_DATA_FILE,
  CLEAN_DATA_FILE,
  CONFIG_FILE,
  SUMMARY_FILE,
  samples_used,
});
```

Then `full-cycle.ts` should:

* Check `result.training_success === true`.
* If true: continue with your existing post-steps (`adapter-merger.ts`, `gguf-converter.ts`, etc.).
* If false: stop, but still finalize SUMMARY_FILE so you have forensics.

`full-cycle.ts` should not know RunPod internals beyond what’s needed for reporting. It just delegates to `runRemoteTraining()` and then moves on with merge/convert.

---

## 3. What `lora-trainer.ts` must do now

`lora-trainer.ts` becomes your RunPod orchestrator and remote executor. It will encapsulate all the steps we’ve been doing by hand. It should export:

```ts
export async function runRemoteTraining(opts: {
  DATE_STR: string;
  WORK_LOCAL: string;
  OUT_ROOT: string;
  FINAL_ADAPTER_DIR: string;
  RAW_DATA_FILE: string;
  CLEAN_DATA_FILE: string;
  CONFIG_FILE: string;
  SUMMARY_FILE: string;
  samples_used: number;
}): Promise<{
  pod_id: string | null;
  ssh_user: string | null;
  ssh_host: string | null;
  training_success: boolean;
  terminated: boolean;
  upload_verification?: string;
}>;
```

Inside `runRemoteTraining`, do the following substeps:

### 3.1. Create the pod via GraphQL

Use curl (spawned via `child_process`) or an HTTP client to call RunPod’s GraphQL API.

You must send a `podFindAndDeployOnDemand` mutation with all required fields, including GPU, resources, and cloudType fallback. The agent already discovered we need to tell RunPod:

* `templateId: "pzr9tt3vvq"`
* `gpuTypeId: "NVIDIA GeForce RTX 5090"`
* `gpuCount: 1`
* `minVcpuCount: 15`
* `minMemoryInGb: 46`
* `volumeInGb: 306`
* `cloudType: COMMUNITY` first, then retry with `SECURE` if `COMMUNITY` fails. 

Do exactly that logic in code:

1. Try COMMUNITY.
2. If error or no pod ID, try SECURE.
3. If still no pod ID → return `{training_success:false, terminated:false}` and write a failure summary.

Save `pod_id`.

### 3.2. Get SSH connection info

You’ve seen that for this template:

* There is no public IP/port in `runtime.ports`.
* Instead you get a gateway login like:

  ```bash
  ssh cgwbwsskymt5ep-64411bd9@ssh.runpod.io -i ~/.ssh/id_ed25519
  ```

So `runRemoteTraining` must support “gateway mode.”

Do this:

* Query `pod` via GraphQL repeatedly until the pod is RUNNING.
* Then attempt a helper fn `discoverGatewaySSH(pod_id)`:

  * First, call `pod` and ask for every possibly-available field that might include SSH info. (You can attempt fields like `id`, `runtime`, `container`, `sshCommand`, etc. If RunPod just returns unknown field errors for some of these, ignore those fields. We only need one success.)
  * If we cannot extract the ssh username programmatically, pause and require it be provided to `runRemoteTraining` via environment/override (for now you can read from a file like `${WORK_LOCAL}/connection.json` if it exists).

    * That file should contain:

      ```json
      {
        "ssh_user": "cgwbwsskymt5ep-64411bd9",
        "ssh_host": "ssh.runpod.io",
        "ssh_key_path": "/home/greggles/.ssh/id_ed25519"
      }
      ```
    * This matches what we discussed to remove human copy/paste mid-run.

For now, since we already know the behavior, you should implement gateway mode as the code path:

* `ssh_host = "ssh.runpod.io"`
* `ssh_user` read from `${WORK_LOCAL}/connection.json` if present, else throw a controlled error telling the caller they need to populate that file once at run start.
* `ssh_key_path` also read from that file.

This lets you finish automating the rest of the pipeline with only one manual prerequisite: dropping `connection.json` before clicking “Run Full Cycle Now.”

Later, you can improve `discoverGatewaySSH` to auto-populate `connection.json` by introspecting GraphQL, but you don’t need that for first pass.

### 3.3. Upload dataset + config using base64-over-ssh

Because `scp` is blocked in gateway mode, you must stream files with base64 and force no-PTY SSH. We already developed this workaround. 

Implement helper functions in `lora-trainer.ts`:

```ts
async function sshExecNoPty({ssh_user, ssh_host, ssh_key_path, remoteCmd}): Promise<{stdout:string, stderr:string, exitCode:number}> { ... }
// use `ssh -T -o StrictHostKeyChecking=no -i ssh_key_path ssh_user@ssh_host "remoteCmd"`

async function sshUploadFileBase64({localPath, remotePath, ssh_user, ssh_host, ssh_key_path}): Promise<void> {
  // shell pipeline:
  // cat localPath | base64 -w 0 | ssh -T ... "base64 -d > remotePath"
}
```

Then in `runRemoteTraining`:

1. `sshExecNoPty("mkdir -p /workspace/input")`

2. Upload dataset:

   ```bash
   cat CLEAN_DATA_FILE | base64 -w 0 | ssh -T ... "base64 -d > /workspace/input/unsloth_dataset.jsonl"
   ```

3. Upload config:

   ```bash
   cat CONFIG_FILE | base64 -w 0 | ssh -T ... "base64 -d > /workspace/input/config.json"
   ```

4. Verify and generate `upload.ok` on the pod:

   ```bash
   ssh -T ... "ls -lh /workspace/input && wc -l /workspace/input/unsloth_dataset.jsonl && sha256sum /workspace/input/config.json > /workspace/input/upload.ok && cat /workspace/input/upload.ok"
   ```

   Capture stdout. Extract the sha256sum line and store it in a variable `upload_verification`.

Even if stdout comes back empty because of gateway quirks, still continue (don’t hang). We’ll re-check `upload.ok` later when we pull artifacts.

### 3.4. Run training remotely

Still via `sshExecNoPty`:

```bash
ssh -T -o StrictHostKeyChecking=no -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" \
  "source /workspace/unsloth-venv/bin/activate && python /workspace/train_unsloth.py"
```

Behavior in code:

* Capture exit code.
* If exitCode !== 0 → `training_success=false`. We will still attempt to pull logs/tar and then terminate pod.

### 3.5. Download adapter artifacts AND upload.ok via tar+base64

We can’t `scp`, so we tar+base64 the output dir:

Remote side (executed via ssh and piped back):

```bash
ssh -T ... "tar czf - /output/adapter /workspace/input/upload.ok" \
  | base64 -w 0 > "$WORK_LOCAL/adapter_base64.txt"
```

Then locally, decode and extract:

```bash
mkdir -p FINAL_ADAPTER_DIR
cat "$WORK_LOCAL/adapter_base64.txt" \
  | base64 -d \
  | tar xz -C "$FINAL_ADAPTER_DIR" --strip-components=2
```

After extraction, `FINAL_ADAPTER_DIR` must contain:

* adapter files from `/output/adapter`
* maybe `upload.ok` (depending on how the strip applies)

Then read `upload.ok` locally and grab the sha256sum line if we didn’t get it earlier.

### 3.6. Terminate the pod

Call `podTerminate` with the `pod_id`. Capture success/failure.

### 3.7. Write run-summary.json

Now `lora-trainer.ts` should assemble and write `SUMMARY_FILE` JSON with all the audit info we decided is required. This summary schema is critical for repeatability and debugging. 

It must include:

```json
{
  "date": "<DATE_STR>",
  "samples_used": <samples_used>,
  "base_model": "<from config.json>",
  "pod_id": "<pod_id>",
  "ssh_user": "<ssh_user>",
  "ssh_host": "<ssh_host>",
  "ssh_key_path": "<ssh_key_path>",
  "connection_mode": "gateway-no-scp-no-pty",
  "adapter_path": "<FINAL_ADAPTER_DIR>",
  "upload_verification": "<sha256sum line from upload.ok>",
  "terminated": true,
  "training_success": true
}
```

* If termination failed, `"terminated": false`.
* If training failed, `"training_success": false`.

Write this file every single run at `SUMMARY_FILE`, even on failure. This gives you forensic visibility day-to-day. This is already in your playbook and docs. 

### 3.8. Return result

`runRemoteTraining()` should `return { pod_id, ssh_user, ssh_host, training_success, terminated, upload_verification }`.

`full-cycle.ts` uses that to decide whether to continue with adapter merge/conversion or bail out.

---

## 4. Integration contract between `full-cycle.ts` and `lora-trainer.ts`

* `full-cycle.ts` prepares:

  * The dataset
  * The config
  * The working directories
  * The numeric `samples_used`

* `lora-trainer.ts`:

  * Allocates remote GPU
  * Pushes data up
  * Trains
  * Pulls adapter back
  * Terminates the pod
  * Writes summary JSON

After `runRemoteTraining()` returns:

* If `training_success === true`, `full-cycle.ts` continues to run your local post-processing (merge adapters with `adapter-merger.ts`, run `gguf-converter.ts`, update symlinks, etc.).
* If `training_success === false`, `full-cycle.ts` stops early, but still leaves the run-summary for debugging.

This split keeps RunPod logic in one place (`lora-trainer.ts`) and keeps high-level orchestration and follow-up in `full-cycle.ts`.

---

## 5. Logging / observability requirements

Please have the agent add logging in both files:

### In `full-cycle.ts`:

* Log each major phase:

  * “Preparing dataset…”
  * “Config written…”
  * “Spawning remote run…”
  * “Remote training complete, success=<bool>…”
  * “Merging adapters…”
  * “Run complete.”

* On any thrown error, catch, write a partial `run-summary.json` with whatever you have (even if `pod_id` is null), and rethrow or exit.

### In `lora-trainer.ts`:

* Log:

  * The chosen `cloudType` (“COMMUNITY” or “SECURE”) that worked.
  * The pod_id assigned.
  * That we switched to “gateway SSH mode.”
  * The number of lines in dataset (`samples_used`).
  * Exit code of the train command.
  * Whether `adapter_base64.txt` was successfully decoded.
  * Whether `podTerminate` succeeded.

Store those logs somewhere under:
`/home/greggles/metahuman/docs/run_logs/<DATE_STR>/trainer.log`
so you have historical forensic data. That matches the plan we wrote in your ops notes. 

---

## 6. TL;DR for the agent (this is the one-line intent)

Update `full-cycle.ts` so that:

* it prepares the dataset, config, and directories,
* then calls `runRemoteTraining()`.

Update `lora-trainer.ts` so that:

* it handles RunPod pod lifecycle end-to-end, including:

  * pod allocation with `podFindAndDeployOnDemand`,
  * gateway SSH (`ssh.runpod.io`, no PTY),
  * base64-over-ssh upload/download,
  * running `/workspace/train_unsloth.py`,
  * tar+base64 adapter retrieval,
  * pod termination,
  * writing `run-summary.json`.

After these changes, clicking “Run Full Cycle Now” should run the whole LoRA training loop against a rented RTX 5090 (or fallback), pull the adapter back to `/home/greggles/metahuman/out/adapters/<DATE_STR>/adapter/`, and generate an auditable summary for that run.
