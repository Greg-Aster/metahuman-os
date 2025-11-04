# SANITY CHECK BEFORE RUN

This is the preflight list. It's short and ruthless.

## 0. Date stamp: 2025-10-24

## Pre-flight checklist:

- [ ] RunPod API key is set in environment
- [ ] SSH key exists at ~/.ssh/id_ed25519 and has correct permissions
- [ ] Connection details are in metahuman-runs/YYYY-MM-DD/connection.json
- [ ] Sufficient GPU credits available for RTX 5090 training
- [ ] Out directory structure exists and is writable
- [ ] Dataset was generated successfully (instructions.jsonl exists)
- [ ] Base model specified in config is accessible
- [ ] All dependencies installed (mkdirp, etc.)