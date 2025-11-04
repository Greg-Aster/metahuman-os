# Training Configuration Files

This directory contains training configurations for different base models. The `training.json` file is the active configuration used by training scripts.

## Available Configurations

### Current Active: `training.json`
**Model**: `openai/gpt-oss-20b` (Harmony format)
- 21B total parameters, 3.6B active (MoE)
- Optimized for 16GB VRAM
- Chat template: Harmony (`<|start|>`, `<|message|>`, `<|end|>`)

### Alternative Configs

**`training-gpt-oss-20b.json`** (same as current training.json)
- OpenAI gpt-oss-20b
- Harmony format
- Best for: Local deployment, consumer hardware

**`training-qwen3-8b.json`**
- Qwen/Qwen3-8B
- ChatML format (`<|im_start|>`, `<|im_end|>`)
- Best for: Quick iteration, 16-24GB VRAM

**`training-qwen3-coder-30b.json`**
- unsloth/Qwen3-Coder-30B-A3B-Instruct
- ChatML format
- Best for: Code generation, RunPod with 80GB VRAM

## Switching Configurations

To use a different model, copy the desired config to `training.json`:

```bash
# Switch to Qwen3-8B
cp etc/training-qwen3-8b.json etc/training.json

# Switch to Qwen3-Coder-30B
cp etc/training-qwen3-coder-30b.json etc/training.json

# Switch to gpt-oss-20b
cp etc/training-gpt-oss-20b.json etc/training.json
```

Then run training as normal:
```bash
./bin/mh-train-local    # Local training
./bin/mh-train-runpod   # RunPod training
```

## Configuration Fields

### Required Fields
- `base_model` - HuggingFace model identifier
- `chat_template` - Template format: `harmony`, `chatml`, `llama`, or `auto`
- `system_prompt` - System message for training data

### Training Parameters
- `max_seq_length` - Maximum sequence length (balance between context and speed)
- `lora_rank` - LoRA rank (8-16, higher = more capacity but slower)
- `lora_alpha` - LoRA alpha (typically 2x rank)
- `num_train_epochs` - Number of epochs (2-3 recommended)
- `learning_rate` - Learning rate (0.0001-0.0002 for LoRA)
- `per_device_train_batch_size` - Batch size per GPU
- `gradient_accumulation_steps` - Effective batch = batch_size × this

### Memory Optimization
- `load_in_4bit` - Use 4-bit quantization (true for most cases)
- `dtype` - Data type (`bfloat16` for modern GPUs)
- `use_gradient_checkpointing` - Trade speed for memory (true recommended)

## Chat Template Formats

### Harmony (gpt-oss)
```
<|start|>developer<|message|>System prompt<|end|>
<|start|>user<|message|>User input<|end|>
<|start|>assistant<|message|>Response<|end|>
```

### ChatML (Qwen)
```
<|im_start|>system
System prompt<|im_end|>
<|im_start|>user
User input<|im_end|>
<|im_start|>assistant
Response<|im_end|>
```

### Llama
```
<s>[INST] <<SYS>>
System prompt
<</SYS>>

User input [/INST] Response </s>
```

## Auto-Detection

If you set `"chat_template": "auto"`, the training script will automatically detect the correct format based on the model name:
- `gpt-oss` or `openai` → harmony
- `qwen` → chatml
- `llama` or `mistral` → llama
- Unknown → chatml (default)

## Creating Custom Configs

To create a new config:

1. Copy an existing config as a template
2. Update `base_model` to your desired model
3. Set `chat_template` to match the model's format (or use `auto`)
4. Adjust training parameters for your hardware
5. Update the `notes` section for documentation

Example:
```bash
cp etc/training-qwen3-8b.json etc/training-my-model.json
# Edit etc/training-my-model.json
cp etc/training-my-model.json etc/training.json
```
