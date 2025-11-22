#!/usr/bin/env python3
"""
Full Fine-Tuning Script for Cognitive Mode Training
Trains entire model weights (not just LoRA adapters)
"""
import json
import os
import sys
import time
import argparse
from datetime import datetime

# Set HuggingFace cache - use /workspace on RunPod, ~/.cache locally
is_runpod = os.path.exists('/workspace') and os.access('/workspace', os.W_OK)
if is_runpod:
    os.environ['HF_HOME'] = '/workspace/.cache/huggingface'
    os.environ['TRANSFORMERS_CACHE'] = '/workspace/.cache/huggingface/transformers'
    os.environ['HF_DATASETS_CACHE'] = '/workspace/.cache/huggingface/datasets'
else:
    cache_dir = os.path.expanduser('~/.cache/huggingface')
    os.environ['HF_HOME'] = cache_dir
    os.environ['TRANSFORMERS_CACHE'] = os.path.join(cache_dir, 'transformers')
    os.environ['HF_DATASETS_CACHE'] = os.path.join(cache_dir, 'datasets')

import importlib
import subprocess

# Progress tracking helper
def log_progress(stage, message, percent=None):
    """Print progress with timestamp and stage indicator"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    if percent is not None:
        print(f"[{timestamp}] 📊 {stage} ({percent}%) - {message}", flush=True)
    else:
        print(f"[{timestamp}] ▶️  {stage} - {message}", flush=True)


def ensure_packages(packages):
    """Ensure required packages are installed"""
    missing = []
    for pkg, import_name in packages:
        try:
            importlib.import_module(import_name or pkg)
        except ImportError:
            missing.append(pkg)

    if not missing:
        return

    log_progress("DEPENDENCIES", f"Installing required packages: {', '.join(missing)}")

    installers = [
        ["uv", "pip", "install", "--upgrade"] + missing,
        [sys.executable, "-m", "pip", "install", "--upgrade", "--break-system-packages"] + missing,
    ]

    for cmd in installers:
        try:
            subprocess.run(cmd, check=True)
            all_available = True
            for pkg, import_name in packages:
                try:
                    importlib.import_module(import_name or pkg)
                except ImportError:
                    all_available = False
                    break
            if all_available:
                log_progress("DEPENDENCIES", f"Packages ready via {' '.join(cmd[:2])}")
                return
        except FileNotFoundError:
            continue
        except subprocess.CalledProcessError as exc:
            print(f"[train_full_finetune] Warning: installer {' '.join(cmd[:2])} failed with exit code {exc.returncode}", file=sys.stderr)

    still_missing = []
    for pkg, import_name in packages:
        try:
            importlib.import_module(import_name or pkg)
        except ImportError:
            still_missing.append(pkg)

    raise RuntimeError(
        f"Failed to install required dependencies: {', '.join(still_missing or missing)}"
    )


def main():
    # Parse command-line arguments for local execution
    parser = argparse.ArgumentParser(description='Full fine-tune training with cognitive modes')
    parser.add_argument('--data', help='Path to training data JSONL file')
    parser.add_argument('--config', help='Path to config JSON file')
    parser.add_argument('--output', help='Output directory for model')
    args = parser.parse_args()

    start_time = time.time()

    log_progress("INIT", "🚀 Starting FULL FINE-TUNING pipeline (cognitive modes)")

    # Install dependencies before importing (A100 templates don't have transformers pre-installed)
    log_progress("DEPENDENCIES", "Checking required packages...")
    ensure_packages([
        ("transformers", "transformers"),
        ("datasets", "datasets"),
        ("torch", "torch"),
        ("accelerate", "accelerate"),
        ("bitsandbytes", "bitsandbytes"),
    ])

    # Import after packages are installed
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        Trainer,
        TrainingArguments,
        DataCollatorForLanguageModeling,
    )
    from datasets import load_dataset
    import torch

    # Use command-line args if provided, otherwise use RunPod defaults
    if args.data and args.config and args.output:
        log_progress("INIT", "🖥️  Running in LOCAL mode")
        data_path = args.data
        config_path = args.config
        output_dir = args.output
    else:
        log_progress("INIT", "☁️  Running in RUNPOD mode")
        input_dir = "/workspace/input"
        data_path = os.path.join(input_dir, "unsloth_dataset.jsonl")  # Matches uploaded filename
        config_path = os.path.join(input_dir, "config.json")
        output_dir = "/workspace/output/model"  # Use /workspace (network volume) instead of /output (container)

    # Defaults matching etc/fine-tune-config.json
    cfg = {
        "base_model": "unsloth/Qwen3-Coder-30B-A3B-Instruct",
        "training_mode": "full_finetune",
        "learning_rate": 5e-6,  # Much lower than LoRA (5e-6 vs 2e-4)
        "num_train_epochs": 3,
        "per_device_train_batch_size": 1,
        "gradient_accumulation_steps": 32,  # Higher to compensate for batch=1
        "max_seq_length": 2048,
        "warmup_steps": 100,
        "logging_steps": 10,
        "save_steps": 500,
        "fp16": False,
        "bf16": True,
        "optim": "adamw_torch",
        "weight_decay": 0.01,
        "max_grad_norm": 1.0,
        "save_total_limit": 2,
        "load_best_model_at_end": True,
        "load_in_8bit": False,  # For 30B models, may need 8-bit on 40GB GPU
    }

    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            file_cfg = json.load(f)
            cfg.update({k: v for k, v in file_cfg.items() if v is not None})

    if not os.path.exists(data_path):
        print(f"[train_full_finetune] Missing dataset: {data_path}", file=sys.stderr)
        sys.exit(2)

    os.makedirs(output_dir, exist_ok=True)

    log_progress("CONFIG", f"Training mode: {cfg.get('training_mode', 'full_finetune')}")
    log_progress("CONFIG", f"Learning rate: {cfg['learning_rate']} (FULL fine-tune - much lower than LoRA)")
    log_progress("CONFIG", f"Epochs: {cfg['num_train_epochs']}")
    log_progress("CONFIG", f"Batch size: {cfg['per_device_train_batch_size']} × {cfg['gradient_accumulation_steps']} = {cfg['per_device_train_batch_size'] * cfg['gradient_accumulation_steps']} effective")

    # Step 1: Load dataset
    log_progress("DATASET", "Loading training data...")
    dataset = load_dataset("json", data_files=data_path, split="train")
    log_progress("DATASET", f"✅ Loaded {len(dataset)} training samples", 100)

    # Validate dataset size
    min_samples = cfg.get('dataset_requirements', {}).get('min_samples', 5000)
    if len(dataset) < min_samples:
        log_progress("DATASET", f"⚠️  Warning: Only {len(dataset)} samples (recommended: {min_samples}+)")
        log_progress("DATASET", "Full fine-tuning works best with 5000+ samples")

    # Step 2: Load tokenizer
    log_progress("TOKENIZER", f"📥 Loading tokenizer for {cfg['base_model']}")
    tokenizer = AutoTokenizer.from_pretrained(cfg["base_model"], use_fast=True)

    # Ensure tokenizer has pad token
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        log_progress("TOKENIZER", f"Set pad_token = eos_token ({tokenizer.eos_token})")

    log_progress("TOKENIZER", "✅ Tokenizer loaded", 100)

    # Step 3: Tokenize dataset
    log_progress("TOKENIZATION", "Converting text to tokens...")

    def tokenize_function(examples):
        # Expect input/output format from fine-tune pipeline
        texts = []
        for inp, out in zip(examples["input"], examples["output"]):
            # Combine input + output for causal LM training
            texts.append(f"{inp}{out}{tokenizer.eos_token}")

        return tokenizer(
            texts,
            truncation=True,
            max_length=cfg["max_seq_length"],
            padding=False,  # We'll use data collator for dynamic padding
        )

    tokenized_dataset = dataset.map(
        tokenize_function,
        batched=True,
        remove_columns=dataset.column_names,
        desc="Tokenizing dataset",
    )

    log_progress("TOKENIZATION", f"✅ Tokenized {len(tokenized_dataset)} samples", 100)

    # Step 4: Load model
    log_progress("MODEL_DOWNLOAD", f"📥 Downloading {cfg['base_model']}")
    log_progress("MODEL_DOWNLOAD", "⚠️  FULL fine-tuning requires ~70GB VRAM for 14B models")

    load_in_8bit = cfg.get("load_in_8bit", False)
    if load_in_8bit:
        log_progress("ERROR", "❌ Cannot use load_in_8bit=True with full fine-tuning!")
        log_progress("ERROR", "8-bit quantization is only for QLoRA (adapter training).")
        log_progress("ERROR", "For full fine-tuning, use bf16 without quantization.")
        sys.exit(1)

    dtype = torch.bfloat16 if cfg.get("bf16", True) else torch.float16

    model_start = time.time()
    model = AutoModelForCausalLM.from_pretrained(
        cfg["base_model"],
        load_in_8bit=load_in_8bit,
        torch_dtype=dtype,
        device_map="auto",
        use_cache=False,  # Required for gradient checkpointing
    )

    # Enable gradient checkpointing to save memory
    model.gradient_checkpointing_enable()

    model_time = time.time() - model_start
    log_progress("MODEL_DOWNLOAD", f"✅ Model loaded in {model_time/60:.1f} minutes", 100)

    # Print model info
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    log_progress("MODEL_INFO", f"Total parameters: {total_params/1e9:.2f}B")
    log_progress("MODEL_INFO", f"Trainable parameters: {trainable_params/1e9:.2f}B (100% - full fine-tune)")

    # Step 5: Training setup
    total_steps = (len(tokenized_dataset) // (cfg["per_device_train_batch_size"] * cfg["gradient_accumulation_steps"])) * cfg["num_train_epochs"]
    log_progress("TRAINING", f"🔥 Starting FULL fine-tuning: {cfg['num_train_epochs']} epochs, ~{total_steps} steps")
    log_progress("TRAINING", f"Estimated time: {total_steps * 2:.0f}-{total_steps * 4:.0f} minutes (2-4 sec/step)")

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=int(cfg["num_train_epochs"]),
        per_device_train_batch_size=int(cfg["per_device_train_batch_size"]),
        gradient_accumulation_steps=int(cfg["gradient_accumulation_steps"]),
        learning_rate=float(cfg["learning_rate"]),
        fp16=bool(cfg.get("fp16", False)),
        bf16=bool(cfg.get("bf16", True)),
        logging_steps=int(cfg.get("logging_steps", 10)),
        save_strategy="steps",
        save_steps=int(cfg.get("save_steps", 500)),
        save_total_limit=int(cfg.get("save_total_limit", 2)),
        warmup_steps=int(cfg.get("warmup_steps", 100)),
        optim=cfg.get("optim", "adamw_torch"),
        weight_decay=float(cfg.get("weight_decay", 0.01)),
        max_grad_norm=float(cfg.get("max_grad_norm", 1.0)),
        # Disabled load_best_model_at_end since we don't have an eval dataset
        load_best_model_at_end=False,
        gradient_checkpointing=True,
        dataloader_pin_memory=True,
        remove_unused_columns=False,
    )

    # Data collator for language modeling
    data_collator = DataCollatorForLanguageModeling(
        tokenizer=tokenizer,
        mlm=False,  # Causal LM, not masked LM
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset,
        data_collator=data_collator,
    )

    # Step 6: Train
    training_start = time.time()
    log_progress("TRAINING", "Training started...")
    trainer.train()
    training_time = time.time() - training_start
    log_progress("TRAINING", f"✅ Training complete in {training_time/60:.1f} minutes", 100)

    # Step 7: Save final model
    log_progress("SAVE_MODEL", "Saving fine-tuned model...")
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    log_progress("SAVE_MODEL", "✅ Model saved", 100)

    # Step 8: GGUF conversion skipped - will be done locally after download
    # This saves RunPod time and allows keeping the full model for future training
    log_progress("GGUF_CONVERT", "ℹ️ GGUF conversion will be done locally after download")
    log_progress("GGUF_CONVERT", "Safetensors model ready for download")

    # Final summary
    total_time = time.time() - start_time
    log_progress("COMPLETE", "=" * 60)
    log_progress("COMPLETE", f"🎉 Full fine-tuning complete in {total_time/60:.1f} minutes")
    log_progress("COMPLETE", f"📁 Model: {output_dir}")
    log_progress("COMPLETE", f"📊 Training stats:")
    log_progress("COMPLETE", f"   - Samples: {len(dataset)}")
    log_progress("COMPLETE", f"   - Epochs: {cfg['num_train_epochs']}")
    log_progress("COMPLETE", f"   - Steps: ~{total_steps}")
    log_progress("COMPLETE", f"   - Learning rate: {cfg['learning_rate']}")
    log_progress("COMPLETE", "=" * 60)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[train_full_finetune] ERROR:", str(e), file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
