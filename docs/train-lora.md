# Training a Small LoRA Adapter (QLoRA) — Guide

This document outlines a local-first path to train a tiny LoRA adapter that biases responses toward Greg’s preferences and style — without modifying the base model.

## 0) Prerequisites
- GPU with CUDA (or Apple Silicon with Metal; adjust frameworks accordingly)
- Python 3.10+
- Conda/venv for isolation
- Base model weights (e.g., Llama/Mistral family) compatible with your runner

## 1) Dataset (exported nightly)
- Run: `pnpm tsx brain/agents/adapter-builder.ts`
- Output: `out/adapters/YYYY-MM-DD/instructions.jsonl`
- Format (JSONL): { instruction, input, output, meta }
- Curate for groundedness and remove ambiguous pairs

## 2) Tooling Options
- Axolotl (https://github.com/OpenAccess-AI-Collective/axolotl)
- Unsloth (https://github.com/unslothai/unsloth)
- PEFT (HuggingFace) + custom scripts

## 3) Example with Axolotl (QLoRA)
Create `config.yaml`:
```yaml
base_model: mistralai/Mixtral-8x7B-Instruct-v0.1
load_in_4bit: true
bnb_4bit_compute_dtype: float16
micro_batch_size: 1
gradient_accumulation_steps: 8
epochs: 1
learning_rate: 1e-4
lora_r: 8
lora_alpha: 16
lora_dropout: 0.05
warmup_steps: 50
dataset: out/adapters/YYYY-MM-DD/instructions.jsonl
dataset_format: jsonl
instruction_key: instruction
input_key: input
output_key: output
save_steps: 200
output_dir: out/adapters/YYYY-MM-DD/checkpoints
save_total_limit: 2
```
Run:
```bash
conda create -n lora python=3.10 -y && conda activate lora
pip install axolotl[flash-attn] # or per Axolotl docs
accelerate config default
axolotl train config.yaml
```
Artifacts:
- LoRA weights in `out/adapters/YYYY-MM-DD/checkpoints` (e.g., `adapter_model.safetensors`)

## 4) Loading the Adapter (Runtime)
- llama.cpp server example:
```bash
./server -m /path/to/base.gguf --lora out/adapters/YYYY-MM-DD/checkpoints/adapter_model.safetensors
```
- vLLM/text-gen-webui: attach LoRA via UI/CLI per tool docs
- Ollama: if/when Modelfile LoRA attach is stable for your version, create a modelfile referencing base + adapter

## 5) Evaluation & Rollback
- Evaluate nightly/weekly on a small test set:
  - Grounding (cites memories), Style similarity, Harm/false positives
- If eval passes, mark adapter active (record path), and load at runtime
- Keep prior adapter; rollback if metrics regress

## 6) Safety Notes
- Keep datasets small and curated; avoid private or unconsented data
- Prefer weekly updates; nightly adaptation can drift
- Always audit training inputs/outputs and adapter activation

```text
Summary:
- Export: adapter-builder → JSONL
- Train: Axolotl/Unsloth (QLoRA)
- Load: base + adapter (no base changes)
- Evaluate: accept or rollback
```

