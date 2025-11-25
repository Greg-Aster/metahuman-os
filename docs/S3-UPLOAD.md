# S3 Upload for Training Models

## Overview

The training pipeline now supports automatic upload to RunPod S3-compatible storage, allowing you to terminate expensive GPU pods immediately after training completes instead of waiting for slow downloads.

## Cost Savings

**Before S3 Upload:**
- Training: 6 minutes
- Download: 10-15 minutes (slow rsync over SSH)
- **Total pod time: ~20 minutes**
- Cost: ~$1.13 for RTX 4090

**With S3 Upload:**
- Training: 6 minutes
- Upload to S3: 2-3 minutes (fast parallel upload)
- **Total pod time: ~9 minutes**
- Cost: ~$0.51 for RTX 4090
- **Savings: ~55%** (can download from S3 later for free)

## Setup

### 1. Configure S3 Credentials

Add these lines to your `.env` file:

```bash
# RunPod S3 Storage Configuration
RUNPOD_S3_ACCESS_KEY="your-access-key"
RUNPOD_S3_SECRET_KEY="your-secret-key"
RUNPOD_S3_ENDPOINT="https://storage.runpod.io"
RUNPOD_S3_BUCKET="metahuman-training"
```

### 2. Get Your S3 Credentials

1. Go to RunPod dashboard: https://www.runpod.io/console/user/settings
2. Navigate to "Settings" → "S3 API Keys"
3. Click "Create S3 API Key"
4. Copy the Access Key and Secret Key into your `.env` file

## How It Works

### Automatic Detection

When S3 credentials are configured in `.env`, the training pipeline automatically:

1. ✅ Trains the model on GPU pod (6 minutes)
2. ☁️ Uploads model to S3 from GPU pod (2-3 minutes)
3. 🛑 Terminates GPU pod immediately (stops billing)
4. 📥 You download from S3 later when convenient (no pod charges)

### Fallback Behavior

If S3 is **not** configured:
- Falls back to direct rsync download (original behavior)
- Pod stays running during 10-15 minute download
- Higher cost but still works

## Usage

### Training with S3 Upload

Just run training normally - S3 upload happens automatically if configured:

```bash
# Fine-tune cycle
./bin/mh agent run fine-tune-cycle

# Full training cycle
./bin/mh agent run full-cycle

# Local training cycle
./bin/mh agent run full-cycle-local
```

### Training Output

You'll see S3 upload progress in the logs:

```
☁️ S3 configured - uploading model to RunPod S3...
⏱️  This will upload the model (~2-3 minutes) then terminate the pod immediately

[Training logs...]

Installing AWS CLI...
Uploading model to s3://metahuman-training/greggles/2025-11-25-101234/model/
✅ Model uploaded to S3!
📍 S3 Location: https://storage.runpod.io/metahuman-training/greggles/2025-11-25-101234/model/
💡 Download later with: aws s3 sync <s3-url> <local-path>
```

### Downloading from S3

After training completes and the pod terminates, download your model:

```bash
# Using the helper script
./bin/s3-download greggles/2025-11-25-101234/model ./out/downloaded-model

# Or using AWS CLI directly
aws s3 sync s3://metahuman-training/greggles/2025-11-25-101234/model/ ./out/downloaded-model \
  --endpoint-url https://storage.runpod.io
```

The download script automatically uses credentials from your `.env` file.

### Installing AWS CLI

The GPU pod installs AWS CLI automatically during training. For local downloads, install AWS CLI:

**Ubuntu/Debian:**
```bash
sudo apt install awscli
```

**macOS:**
```bash
brew install awscli
```

**Other platforms:**
https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

## S3 Storage Structure

Models are organized by username and run label:

```
s3://metahuman-training/
├── greggles/
│   ├── 2025-11-25-101234/
│   │   └── model/
│   │       ├── config.json
│   │       ├── model-00001-of-00004.safetensors
│   │       ├── model-00002-of-00004.safetensors
│   │       ├── model-00003-of-00004.safetensors
│   │       ├── model-00004-of-00004.safetensors
│   │       ├── model.safetensors.index.json
│   │       ├── tokenizer.json
│   │       └── tokenizer_config.json
│   └── 2025-11-25-105678/
│       └── model/...
└── other-user/
    └── ...
```

## Excluded Files

To save space and upload time, these checkpoint files are **excluded** from S3 upload:

- `checkpoint-*` (intermediate checkpoints, ~24GB)
- `*.pt`, `*.pth` (PyTorch checkpoint files)
- `optimizer.pt`, `scheduler.pt`, `rng_state.pth`

Only the final merged model (~4-6GB) is uploaded.

## Troubleshooting

### S3 Upload Failed

If upload fails, the training will **not** fail. The error is logged and you can:

1. Check S3 credentials in `.env`
2. Verify RunPod S3 service is available
3. Try downloading directly via rsync (pod stays running until finally block)

### Cannot Find Model in S3

Check the training logs for the exact S3 path:

```bash
grep "S3 Location" docs/run_logs/2025-11-25/*/train.log
```

### AWS CLI Not Found Locally

Install AWS CLI for local downloads (see "Installing AWS CLI" above).

## Technical Details

### Upload Script

The training pipeline generates and executes this script on the GPU pod:

```bash
#!/bin/bash
set -e

# Install AWS CLI if not present
if ! command -v aws &> /dev/null; then
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip -q awscliv2.zip
  ./aws/install
fi

# Configure AWS credentials
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_ENDPOINT_URL="https://storage.runpod.io"
export AWS_DEFAULT_REGION="us-east-1"

# Upload model directory to S3 (excluding checkpoints)
aws s3 sync /workspace/output/model s3://metahuman-training/username/run-label/model/ \
  --exclude "checkpoint-*" \
  --exclude "*.pt" \
  --exclude "*.pth" \
  --endpoint-url "https://storage.runpod.io"
```

### Implementation Files

- [packages/core/src/s3-upload.ts](../packages/core/src/s3-upload.ts) - S3 client and upload functions
- [brain/agents/lora-trainer.ts](../brain/agents/lora-trainer.ts) - Training pipeline with S3 integration (lines 1038-1123)
- [bin/s3-download](../bin/s3-download) - Helper script for downloading from S3

### Result Metadata

When S3 upload succeeds, the training result includes:

```typescript
{
  training_success: true,
  s3_url: "https://storage.runpod.io/metahuman-training/greggles/2025-11-25-101234/model/",
  s3_key: "greggles/2025-11-25-101234/model",
  // ... other fields
}
```

This metadata is saved in the run summary JSON file.

## Future Enhancements

Potential improvements for the S3 upload system:

- [ ] Progress tracking UI in web dashboard
- [ ] Automatic background download after training
- [ ] S3 bucket lifecycle policies for automatic cleanup
- [ ] Support for other S3-compatible providers (AWS, Backblaze, etc.)
- [ ] Parallel downloads using multipart download
