# Configuration Surface

`etc/` contains maintained machine configuration, profile seed configuration,
and canonical cognitive graphs. Runtime and personal values remain local.

## Ownership

- Machine services read their named files here, including `agents.json`,
  `services.json`, `queue.json`, `llm-backend.json`, and `voice-servers.json`.
- Profile creation copies supported defaults into
  `profiles/<username>/etc/`. Profile runtime then reads the authenticated
  user's copy.
- `*.json.template` files are profile seeds, not independent runtime owners.
- `*.json.example` files contain placeholders only. Never put live credentials
  in a tracked file.
- `cognitive-graphs/*.json` are the canonical built-in graphs. Graph-editor
  backups and custom graphs are local runtime data.

Use the corresponding Core loader or service owner. Do not add direct path reads
when a public configuration contract already exists.

## Training

- `training.json` is the single seed for the profile's training settings.
- Core's launcher freezes those settings for local LoRA, remote LoRA and full
  fine-tuning. Worker-specific defaults and cognitive-mode optimizer overrides
  are retired; cognitive mode never silently changes the learning objective.
- Training datasets use structured messages. The trainer applies the selected tokenizer's chat template once; model-family wrapper files are not used.

The maintained default family is Qwen 3.5. A new model-family preset belongs in
maintained source only after its loader, precision, schema, output target, and
focused tests are implemented. Do not keep speculative presets beside the live
configuration.

## Safe changes

Prefer the web settings and Trigger Manager interfaces when available. They
validate and atomically apply supported values. For direct changes, stop the
owning process, preserve the existing schema, and run the focused configuration,
graph, or model-default contract tests.

See `docs/user-guide/configuration-admin/configuration-files.md` for the user
reference and `docs/technical/REFACTOR_BLUEPRINT.md` for repository rules.
