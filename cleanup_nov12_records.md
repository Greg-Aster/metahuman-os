# Cleanup Records - November 12, 2025

## Unused Dependency: `node-ssh`

**Finding:**
The `node-ssh` dependency was identified in the root `package.json`. Upon investigation, it was found that the `lora-trainer.ts` script, which handles remote SSH/SCP operations to RunPod, does not utilize the `node-ssh` library. Instead, it directly uses Node.js's `child_process.spawn` to execute system `ssh` and `scp` commands.

**Conclusion:**
`node-ssh` appears to be an unused dependency.

**Action Proposed:**
Removal of `node-ssh` from `package.json` and subsequent `pnpm install` to clean up `node_modules`.

**Status:**
Completed.

## Redundant Dependency: `mkdirp`

**Finding:**
The `mkdirp` dependency was identified in the root `package.json`. The `lora-trainer.ts` script was found to be using `mkdirpSync` for directory creation. However, `fs-extra`, which is already a dependency in `packages/core`, provides equivalent functionality (`ensureDirSync`).

**Conclusion:**
`mkdirp` is a redundant dependency.

**Action Taken:**
1.  Modified `brain/agents/lora-trainer.ts` to replace `import { mkdirpSync } from 'mkdirp';` with `import { ensureDirSync } from 'fs-extra';` and all calls to `mkdirpSync` with `ensureDirSync`.
2.  Removed `mkdirp` from the root `package.json`.
3.  Ran `pnpm install` to remove the package and update the lockfile.

**Status:**
Completed.