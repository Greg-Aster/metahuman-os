# LLM Backend Configuration

MetaHuman routes model requests through the deployment backend owner and model
provider bridge. Supported target families include Ollama, vLLM, llama.cpp, the maintained
local-model service, configured remote providers, and automatic selection.

## Configuration owner

`etc/llm-backend.json` is machine-wide deployment configuration, not a
profile-specific file. Model-role assignments and provider records are resolved
through the model registry and provider bridge. Prefer Backend Settings or the
CLI instead of creating provider-specific routing files.

Important fields include:

- `activeBackend`: `ollama`, `vllm`, `llama-cpp`, `local-models`, `remote`, or the supported automatic mode;
- `ollama.endpoint` and `ollama.defaultModel`;
- `vllm.endpoint`, model identity, context length, and memory controls;
- `llamaCpp.endpoint`, served model name, context/output limits and capabilities;
- `remote.serverUrl` and remote model identity;
- `preferredLocalBackend` for automatic local routing.

Do not store credentials in this tracked seed file. Use the credential owner exposed by the application.

## Inspect and switch backends

```bash
./bin/mh backend status
./bin/mh backend detect
./bin/mh backend start
./bin/mh backend switch ollama
./bin/mh backend switch vllm
```

The switch command updates the canonical configuration. Do not run parallel router implementations or edit call sites to bypass it.

## Image-capable requests

Images travel through the same model-role, backend, and provider path as text.
There is no separate vision backend setting. When a role-selected model is
explicitly text-only, the router may use the configured orchestrator-role model;
the final model and provider adapter must support image input or the request
fails with a visible error. Configure image capability in the model catalog
instead of adding a second backend or a call-site-specific override.

## Ollama

Start Ollama using the installation's normal service mechanism or `ollama serve`, then inspect it through MetaHuman:

```bash
./bin/mh ollama status
./bin/mh ollama list
./bin/mh ollama pull MODEL
./bin/mh ollama info MODEL
```

The model named by `ollama.defaultModel` must be installed. Role-specific model selection remains owned by the model catalog/router; changing a single call site is not a supported routing mechanism.

## vLLM

Use the vLLM lifecycle owner so startup parameters, model identity, adapters, and memory limits stay consistent:

```bash
./bin/mh vllm status
./bin/mh vllm start
./bin/mh vllm stop
./bin/mh vllm restart
```

Run `./bin/mh vllm` for supported overrides. If startup fails, reduce configured GPU utilization or context length and inspect the reported log rather than launching a second unmanaged server.

## llama.cpp

In **System → Backend**, choose **llama.cpp** or use its **Save and use llama.cpp**
button. Enter the server root URL (for example `http://127.0.0.1:8080`, without
`/v1`), the exact model name returned by `/v1/models`, and the context limit used
when launching the server. Configure a smaller output-token budget. Enable image
input only when the served model and its loaded vision projector support it.
Text, image parts and structured output use the same provider path.

Start `llama-server` with the installation's existing service. MetaHuman checks
its health and model identity; it does not start a competing process or download
weights. `mh backend start` verifies an externally managed llama.cpp server is
ready. Connection failures and model mismatches remain visible errors.

Selecting llama.cpp overrides local chat and action-role model assignments on
this installation. Synced profile registries retain their original assignments;
embedding services and explicitly chosen cloud/remote-server roles retain their
own providers. The model inventory displays the effective local model. Automatic
selection can prefer llama.cpp through `preferredLocalBackend`.

Server Status refreshes when opened, when the page becomes visible, after a
control action, on backend-change events, or with its refresh button. It has no
periodic status polling.

The separate Local Model Service panel reads its inventory from that service.
After requesting a download, use **Refresh model status** to check completion.
Unavailable inventory is shown as an error.

## Remote backend

Configure the server URL and credentials in Backend Settings. Test the connection there before selecting the remote target. Remote requests still pass through the same provider bridge and authorization path as local requests.

## Troubleshooting

- **Backend unavailable:** run `./bin/mh backend status`, then the selected provider's status command.
- **Model not found:** compare the configured model identity with the provider's installed or served model name.
- **GPU out of memory:** stop competing GPU work or lower vLLM memory/context settings.
- **Remote connection fails:** verify the URL, credentials, TLS, and remote health endpoint.
- **A role uses an unexpected model:** inspect the model catalog and role routing; do not patch the consumer.

See [Configuration Files](/user-guide#configuration-files) and [Troubleshooting](/user-guide#troubleshooting).
