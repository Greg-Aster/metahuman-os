# RunPod Remote Training Setup - Progress Documentation

**Date:** October 27, 2025
**Status:** ✅ All Issues Fixed | 🚀 Ready for Final Training Test
**Last Updated:** Docker image v4-unsloth-api-fix built and pushed to Docker Hub

## Overview

This document tracks the complete journey of setting up autonomous remote LoRA training on RunPod infrastructure. The goal is to enable MetaHuman OS to train personalized language models automatically using episodic memory.

---

## Current Status

### ✅ Working Components

1. **Docker Image with SSH Access**
   - Base image: `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`
   - Latest version: `docker.io/gregoryaster/metahuman-runpod-trainer:v4-unsloth-api-fix`
   - SSH server configured with public key authentication
   - Auto-generates SSH host keys on startup
   - Python venv with Unsloth and dependencies
   - **Xformers built from source** for RTX 5090 (Blackwell) compatibility
   - **Fixed UnslothTrainer API** for proper LoRA training

2. **SSH Connection & Authentication**
   - Direct SSH to pod's public IP working
   - Automatic port discovery (TCP port 22)
   - SSH key path auto-detection (`~/.ssh/id_ed25519`)
   - Retry logic (12 attempts × 5 seconds) for container startup delays

3. **File Upload System**
   - Dataset upload via base64-over-SSH: ✅ Working
   - Config file upload: ✅ Working
   - SHA256 verification: ✅ Working

4. **Remote Script Execution**
   - Training script execution: ✅ Working
   - Output capture (stdout/stderr): ✅ Working

### ✅ Recently Fixed Issues

1. **Xformers Compatibility (RTX 5090)** - RESOLVED
   - Error: `Xformers does not work in RTX 50X, Blackwell GPUs`
   - Solution: Built Xformers from source in Dockerfile
   - Status: ✅ Fixed in v3-xformers-5090 (pushed to Docker Hub)
   - Build time: ~20 minutes for xformers compilation

---

## Architecture

### System Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Local System (MetaHuman OS)                              │
│    - Generates dataset from episodic memory                 │
│    - Creates training configuration                         │
│    - Runs full-cycle.ts orchestrator                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. RunPod API                                                │
│    - Deploy pod with custom Docker image                    │
│    - Request: GPU (RTX 5090), Template ID, Cloud Type       │
│    - Response: Pod ID, runtime ports (IP:port)              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. RunPod Pod (Remote Container)                            │
│    ┌──────────────────────────────────────────────────────┐ │
│    │ Docker Container                                     │ │
│    │ - Base: PyTorch 2.8.0 + CUDA 12.8                   │ │
│    │ - SSH server on port 22                             │ │
│    │ - Python venv with Unsloth                          │ │
│    │ - Training script: train_unsloth.py                 │ │
│    └──────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. SSH Connection & File Transfer                           │
│    - Direct SSH: root@<public-ip>:<public-port>            │
│    - Upload via: cat file | base64 | ssh ... "base64 -d"   │
│    - Files: dataset.jsonl + config.json                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Remote Training Execution                                │
│    - Command: source venv && python train_unsloth.py       │
│    - Output: Streamed via SSH (stdout/stderr)              │
│    - Artifacts: /output/adapter/*.gguf                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Artifact Download                                        │
│    - Command: tar czf - /output/adapter | base64           │
│    - Transfer: SSH stream → local decode → extract         │
│    - Destination: out/adapters/<date>/adapter/             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Pod Cleanup                                              │
│    - Terminate pod via RunPod API                          │
│    - Cost: ~$0.74/hr for RTX 5090                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Files

### Docker Image

**Location:** `docker/runpod-trainer/`

```
docker/runpod-trainer/
├── Dockerfile           # Container definition
├── start.sh            # SSH setup + daemon start
└── train_unsloth.py    # LoRA training script
```

**Dockerfile Highlights:**
- **Base:** `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`
- **Packages:** openssh-server, git, ninja-build
- **Python:** venv with pip, setuptools, wheel, ninja
- **Libraries:** xformers (from source), unsloth, transformers, datasets, accelerate, peft, bitsandbytes
- **SSH:** Public key auth, root login with key, port 22

**start.sh Highlights:**
- Reads `SSH_PUBLIC_KEY` environment variable
- Adds key to `~/.ssh/authorized_keys`
- **Generates SSH host keys** with `ssh-keygen -A` (critical fix)
- Starts sshd in foreground (`-D -e`)

### Training Orchestrator

**Location:** `brain/agents/lora-trainer.ts`

**Key Functions:**
- `runRemoteTraining(opts)` - Main orchestrator
- `sshExecNoPty()` - Execute SSH commands without PTY
- `sshUploadFileBase64()` - Upload files via base64 encoding

**Critical Code Sections:**

1. **SSH Key Path Initialization (lines 445-459)**
   ```typescript
   // Load SSH key path EARLY (before probe)
   if (!ssh_key_path && existingConn?.ssh_key_path) {
     ssh_key_path = existingConn.ssh_key_path;
   }
   if (!ssh_key_path && ENV_SSH_KEY_PATH) {
     ssh_key_path = ENV_SSH_KEY_PATH;
   }
   if (!ssh_key_path) {
     const defaultKey = path.join(process.env.HOME || '', '.ssh', 'id_ed25519');
     if (fs.existsSync(defaultKey)) {
       ssh_key_path = defaultKey;
     }
   }
   ```

2. **Port Selection (lines 464-467)**
   ```typescript
   // Prioritize TCP port 22 over UDP
   const sshPortMapping = lastRuntimePorts.find(
     (p: any) => p.isIpPublic && p.privatePort === 22 && p.type?.toLowerCase() === 'tcp'
   ) || /* fallbacks */
   ```

3. **SSH Retry Loop (lines 480-502)**
   ```typescript
   // Retry up to 60 seconds for SSH to become available
   for (let attempt = 1; attempt <= 12; attempt++) {
     const probe = await sshExecNoPty(user, host, keyPath, 'true', port);
     if (probe.exitCode === 0) {
       // Success!
       break;
     }
     await new Promise(r => setTimeout(r, 5000)); // 5 sec delay
   }
   ```

### Full Cycle Script

**Location:** `brain/agents/full-cycle.ts`

**Workflow:**
1. Prepare dataset from `out/adapters/<date>/`
2. Build dataset (filter, clean, validate)
3. Create training config
4. Call `runRemoteTraining()` from lora-trainer
5. Write summary to `metahuman-runs/<date>/run-summary.json`

---

## Bugs Fixed

### 1. SSH Host Keys Missing ✅
**Problem:** Container's sshd failed with "no hostkeys available"
**Root Cause:** Base image doesn't include pre-generated SSH host keys
**Solution:** Added `ssh-keygen -A` to start.sh
**File:** [`docker/runpod-trainer/start.sh:33-37`](docker/runpod-trainer/start.sh)
**Impact:** SSH server now starts successfully

### 2. Stale Connection IP ✅
**Problem:** Used old pod IP from previous run's connection.json
**Root Cause:** Code loaded stale connection.json before checking runtime.ports
**Solution:** Always prefer runtime.ports when `RUNPOD_NO_GATEWAY=1`
**File:** [`brain/agents/lora-trainer.ts:463`](brain/agents/lora-trainer.ts)
**Code Change:**
```typescript
// OLD: if ((!ssh_user || !ssh_host) && lastRuntimePorts...)
// NEW: if ((NO_GATEWAY || !ssh_user || !ssh_host) && lastRuntimePorts...)
```
**Impact:** Always uses fresh pod IP from API

### 3. TCP/UDP Port Confusion ✅
**Problem:** Selected UDP port 22 instead of TCP port 22
**Root Cause:** Port array had UDP first; code didn't filter by type
**Solution:** Prioritize TCP ports explicitly
**File:** [`brain/agents/lora-trainer.ts:464-467`](brain/agents/lora-trainer.ts)
**Impact:** SSH connects to correct TCP port

### 4. SSH Key Path Empty ✅
**Problem:** `keyPathCandidate` was empty during SSH probe
**Root Cause:** SSH key path initialized AFTER probe section
**Solution:** Moved key path initialization before probe (line 445)
**File:** [`brain/agents/lora-trainer.ts:445-459`](brain/agents/lora-trainer.ts)
**Impact:** SSH key now available for authentication

### 5. No Retry for Container Startup ✅
**Problem:** SSH probe failed immediately if container not ready
**Root Cause:** No retry logic; expected instant availability
**Solution:** Added 12-attempt retry loop with 5-second delays
**File:** [`brain/agents/lora-trainer.ts:480-502`](brain/agents/lora-trainer.ts)
**Impact:** Tolerates 60-second container startup time

### 6. Xformers RTX 5090 Incompatibility ⚠️ (In Progress)
**Problem:** Training fails: "Xformers does not work in RTX 50X"
**Root Cause:** Pre-built xformers doesn't support new Blackwell architecture
**Solution:** Build xformers from source in Dockerfile
**File:** [`docker/runpod-trainer/Dockerfile:30-31`](docker/runpod-trainer/Dockerfile)
**Status:** Dockerfile updated, needs rebuild with setuptools fix

---

## Environment Configuration

### Required Environment Variables

**`.env` file:**
```bash
# RunPod API Key
RUNPOD_API_KEY="rpa_..."

# RunPod Template ID (created in RunPod console)
RUNPOD_TEMPLATE_ID="6r5jlk3b89"

# Force direct SSH (skip gateway)
RUNPOD_NO_GATEWAY=1

# SSH user for direct connection
RUNPOD_DIRECT_SSH_USER=root

# Optional: Custom SSH key path
# RUNPOD_SSH_KEY_PATH="/home/user/.ssh/custom_key"
```

### RunPod Template Configuration

**Template ID:** `6r5jlk3b89`
**Name:** metahuman-runpod-trainer
**Created via:** RunPod Console → Templates → New Template

**Settings:**
- **Container Image:** `docker.io/gregoryaster/metahuman-runpod-trainer:v2-20251026-211617`
- **Container Disk:** 40 GB
- **Networking:**
  - ✅ Enable Public IP
  - **Expose TCP Ports:** `22`
- **Environment Variables:**
  ```
  SSH_USER=root
  SSH_PUBLIC_KEY=ssh-ed25519 AAAAC3Nza... greggles@DNDIY
  ```

**GPU Requirements:**
- **Type:** NVIDIA GeForce RTX 5090
- **Count:** 1
- **Min vCPU:** 15
- **Min Memory:** 46 GB
- **Volume:** 306 GB

---

## Testing & Validation

### Manual SSH Test

Test SSH connection to a running pod:

```bash
# Get pod info from logs or API
POD_IP="194.14.47.19"
POD_PORT="22834"

# Test connection
ssh -vv \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  -i ~/.ssh/id_ed25519 \
  -p $POD_PORT \
  root@$POD_IP \
  'echo "SSH SUCCESS"'
```

**Expected Output:**
```
debug1: Authentication succeeded (publickey).
SSH SUCCESS
```

### Local Docker Test

Test the Docker image locally before pushing:

```bash
# Run container with SSH
docker run -d --rm \
  -e SSH_USER=root \
  -e SSH_PUBLIC_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
  -p 2222:22 \
  --name metahuman-test \
  metahuman-runpod-trainer:latest

# Wait for startup
sleep 5

# Check logs
docker logs metahuman-test
# Expected: "[start] Generating SSH host keys..."
#           "Server listening on 0.0.0.0 port 22."

# Test SSH
ssh -o StrictHostKeyChecking=no \
    -o BatchMode=yes \
    -i ~/.ssh/id_ed25519 \
    -p 2222 \
    root@localhost \
    'echo ok'

# Cleanup
docker stop metahuman-test
```

### Full Training Cycle

Run the complete autonomous training:

```bash
# Execute full cycle
pnpm tsx brain/agents/full-cycle.ts

# Monitor progress (separate terminal)
tail -f docs/run_logs/$(date +%Y-%m-%d)/trainer.log

# Check results
ls -lh out/adapters/$(date +%Y-%m-%d)/adapter/
```

**Expected Log Output:**
```
[lora-trainer] Pod created successfully on COMMUNITY cloud. Pod ID: xxx
[lora-trainer] Using default SSH key path: /home/greggles/.ssh/id_ed25519
[lora-trainer] Direct SSH handshake succeeded as root@IP:PORT (attempt 1)
[lora-trainer] Upload of unsloth_dataset.jsonl successful.
[lora-trainer] Upload of config.json successful.
[lora-trainer] Executing remote training script...
[lora-trainer] Training exit code: 0
[lora-trainer] Adapter extracted successfully.
```

---

## Docker Image Versions

### Version History

| Tag | Date | Changes | Status |
|-----|------|---------|--------|
| `v2-20251026-211617` | 2025-10-26 | SSH host key generation | ✅ SSH Working |
| `v3-xformers` | 2025-10-27 | Build xformers from source | ⚠️ Build Failed (setuptools) |
| `v3-xformers-fixed` | TBD | Add setuptools to venv | 🚧 Pending |

### Building New Versions

```bash
# Build with unique tag
TAG="v3-$(date +%Y%m%d-%H%M%S)"
docker build --no-cache -t metahuman-runpod-trainer:$TAG docker/runpod-trainer

# Tag for Docker Hub
docker tag metahuman-runpod-trainer:$TAG \
  docker.io/gregoryaster/metahuman-runpod-trainer:$TAG

# Push to Docker Hub
docker login
docker push docker.io/gregoryaster/metahuman-runpod-trainer:$TAG

# Update RunPod template with new tag
# Go to: https://www.runpod.io/console/user/templates
# Edit template → Change Container Image to new tag → Save
```

---

## Cost Analysis

### RunPod Pricing (Community Cloud)

- **GPU:** NVIDIA GeForce RTX 5090
- **Rate:** $0.74/hour
- **Typical Training Time:** 10-30 minutes
- **Cost per Run:** $0.12 - $0.37

### Monthly Estimates

| Frequency | Runs/Month | Cost/Month |
|-----------|------------|------------|
| Daily | 30 | $3.60 - $11.10 |
| Weekly | 4 | $0.48 - $1.48 |
| On-demand | Variable | Pay-as-you-go |

---

## Troubleshooting

### SSH Connection Fails

**Symptoms:**
- "Connection refused"
- "Permission denied (publickey)"
- Exit code 255

**Diagnostics:**
```bash
# Check pod logs in RunPod console
# Look for:
#   "[start] Generating SSH host keys..."
#   "Server listening on 0.0.0.0 port 22."

# Verify SSH key
ls -l ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub

# Check key in template
# RunPod Console → Templates → Edit → Environment Variables
# Verify SSH_PUBLIC_KEY matches your public key
```

**Solutions:**
1. Ensure Docker image has SSH host key generation
2. Verify SSH public key in template matches local private key
3. Check template exposes TCP port 22
4. Enable public IP in template
5. Wait longer (retry loop handles startup delays)

### Pod Never Becomes Ready

**Symptoms:**
- "Waiting for pod ssh gateway... (Attempt 60/60)"
- runtime.ports stays null

**Diagnostics:**
```bash
# Check pod status via API
curl -s -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"query": "query { pod(input: {podId: \"POD_ID\"}) { id desiredStatus runtime { ports { ip publicPort } } } }"}' \
  https://api.runpod.io/graphql | jq .
```

**Common Causes:**
1. No GPUs available in selected cloud (COMMUNITY/SECURE)
2. Docker image too large / slow to pull
3. Docker image pull failed
4. RunPod infrastructure issues

**Solutions:**
1. Wait longer (first pull can take 5-10 minutes)
2. Use smaller image
3. Try different cloud type
4. Use pre-cached image tag

### Training Script Fails

**Symptoms:**
- "Training exit code: 1"
- Error in stderr output

**Current Issue:**
```
Unsloth: Xformers does not work in RTX 50X, Blackwell GPUs
```

**Solution:**
Build xformers from source (in progress)

---

## Next Steps

### Immediate (Current Session)

1. ✅ Fix SSH connection issues
2. ✅ Implement retry logic
3. ⚠️ Fix xformers build (add setuptools to Dockerfile)
4. 🚧 Complete successful training run
5. 🚧 Test adapter download and integration

### Short-term

1. Optimize Docker image size (multi-stage build?)
2. Add training progress monitoring
3. Implement automatic adapter installation
4. Add training metrics logging
5. Create rollback mechanism for failed adapters

### Long-term

1. Support multiple GPU types (A100, H100, etc.)
2. Add training hyperparameter tuning
3. Implement distributed training for larger datasets
4. Add cost optimization (spot instances, auto-shutdown)
5. Create training scheduler for off-peak hours

---

## References

### Documentation

- [RunPod API Docs](https://docs.runpod.io/graphql-api)
- [Unsloth Documentation](https://github.com/unslothai/unsloth)
- [Xformers GitHub](https://github.com/facebookresearch/xformers)

### Related Files

- [`ARCHITECTURE.md`](ARCHITECTURE.md) - MetaHuman OS overall architecture
- [`DESIGN.md`](DESIGN.md) - System design principles
- [`CLAUDE.md`](CLAUDE.md) - Development guidelines

### Key Commands

```bash
# Run full training cycle
pnpm tsx brain/agents/full-cycle.ts

# Check RunPod status
./bin/mh ollama status

# View training logs
tail -f docs/run_logs/$(date +%Y-%m-%d)/trainer.log

# List Docker images
docker images gregoryaster/metahuman-runpod-trainer

# Check RunPod templates
# Visit: https://www.runpod.io/console/user/templates
```

---

**Document Version:** 1.0
**Last Successful Training:** N/A (pending xformers fix)
**Last Successful SSH Connection:** 2025-10-27 04:38:47 UTC
**Last Updated By:** Claude (Sonnet 4.5)
