# RunPod Autonomy Status — 2025-10-25

This note summarizes the current state of remote training via RunPod, what’s working, what’s blocking, and the exact next steps to resume.

## Current Behavior

- Pod creation: Succeeds via GraphQL using `RUNPOD_TEMPLATE_ID` when provided; falls back to a default template ID otherwise.
- Trainer flow: Updated to be autonomous where possible.
  - Polls for `runtime.ports` (no schema breakage).
  - Attempts gateway discovery if possible (but schema blocks it in this environment).
  - Falls back to direct SSH to public IP:port if available.
  - Reads only `ssh_key_path` from `${WORK_LOCAL}/connection.json` and writes fresh per-run `connection.json` with live values.
- Logging and hygiene:
  - Per-run logs under `docs/run_logs/<DATE>/trainer.log`.
  - `metahuman-runs/` and `docs/run_logs/` are in `.gitignore`.

## What’s Working

- Pod deploys and runs; `sshd` and `jupyter` start inside the container.
- Trainer handles missing `sshCommand` without crashing the main loop.
- Trainer can use direct SSH mode if a public IP:22 is exposed.
- `RUNPOD_TEMPLATE_ID` is now read from `.env`.

## Blocking Issues Observed

- Gateway path blocked:
  - GraphQL errors: `Cannot query field "sshCommand" on type "PodRuntime".`
  - Introspection disabled: Apollo rejects `__schema`/`__type` queries.
  - Net effect: we cannot auto-discover the RunPod gateway username.
- Direct SSH path unavailable on current deployments:
  - `runtime.ports` shows only private HTTP mappings or `null`.
  - No `isIpPublic: true` entry for `privatePort: 22`.
  - Without public SSH and a pre-installed key, the trainer cannot connect.
- Raw image launch caused GPU runtime error:
  - NVIDIA runtime error indicates launching an image directly (not via a properly configured template) — avoid raw image deploys for this workflow.

## Required RunPod-Side Fix (One-Time)

To enable fully autonomous runs, ensure the template used by the trainer provides direct SSH:

1. Use a real Template ID (not a raw image reference).
   - Recommended image: `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`.
   - Create/duplicate a Template in RunPod and copy its Template ID (e.g., `pzr...`).
2. Public networking:
   - Enable public IP.
   - Publish TCP 22 publicly (ingress enabled).
3. Install SSH key at boot:
   - If the Template UI supports “SSH Public Key”, paste `~/.ssh/id_ed25519.pub` and choose the SSH user (e.g., `root`).
   - Otherwise, add a startup script and envs:
     - Env: `SSH_PUBLIC_KEY` = contents of your `~/.ssh/id_ed25519.pub`
     - Env: `SSH_USER` = `root` (or `unsloth`)
     - Startup command:
       ```bash
       #!/usr/bin/env bash
       set -euo pipefail
       user="${SSH_USER:-root}"
       pub="${SSH_PUBLIC_KEY:?Missing SSH_PUBLIC_KEY env}"
       home="$(getent passwd "$user" | cut -d: -f6)"
       mkdir -p "$home/.ssh"
       touch "$home/.ssh/authorized_keys"
       grep -qxF "$pub" "$home/.ssh/authorized_keys" || echo "$pub" >> "$home/.ssh/authorized_keys"
       chown -R "$user:$user" "$home/.ssh"
       chmod 700 "$home/.ssh"
       chmod 600 "$home/.ssh/authorized_keys"
       service ssh start || /usr/sbin/sshd
       exec supervisord -n || true
       ```

Once this is in place, the trainer will auto-detect the public IP:22 and connect with your key — no per-run edits required.

## Local .env Setup

- Copy `env-template` to `.env` and fill:
  - `RUNPOD_API_KEY=...`
  - `RUNPOD_TEMPLATE_ID=...` (use the Template ID from your account)
  - Optional: `RUNPOD_NO_GATEWAY=1` to suppress gateway schema probes (since your schema blocks them)
  - Optional: `RUNPOD_DIRECT_SSH_USER=root` to skip user probing

## Code Changes Already Made

- `brain/agents/lora-trainer.ts`
  - Polls only supported fields; avoids hard failures on missing `sshCommand`.
  - Fresh per-run `connection.json` written from live values; only reads `ssh_key_path` from prior runs.
  - Added direct SSH fallback to public IP:port with optional port support; tries `root` and `unsloth` automatically.
  - Hardened SSH options: `BatchMode=yes`, `UserKnownHostsFile=/dev/null`, quoting fixes.
  - Reads `RUNPOD_TEMPLATE_ID` from `.env`.
- `.gitignore`: ignore `metahuman-runs/` and `docs/run_logs/`.
- `env-template`: added with the relevant env keys and guidance.

## Where to Resume

1. Create/duplicate a RunPod Template with public SSH and your key installed (see “Required RunPod-Side Fix”).
2. Put the Template ID into `.env` as `RUNPOD_TEMPLATE_ID`.
3. Optionally set:
   - `RUNPOD_NO_GATEWAY=1` (reduces GraphQL noise in logs)
   - `RUNPOD_DIRECT_SSH_USER=root` (skip user probing)
4. Re-run the full cycle.
5. Verify in `docs/run_logs/<DATE>/trainer.log`:
   - `runtime.ports: [...]` contains `isIpPublic: true` and `privatePort: 22`.
   - Connection mode logged as `direct-ssh-no-pty` with `user@ip:port`.

## Potential Follow-Ups (Optional)

- Wire `RUNPOD_NO_GATEWAY` to fully skip schema probes (minor code tweak).
- Wire `RUNPOD_DIRECT_SSH_USER` to force a specific user without probing.
- Consider a custom image if you need to harden the SSH setup or bake training deps.

---

This doc reflects the state as of 2025‑10‑25 based on observed logs and code.
