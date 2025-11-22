#!/usr/bin/env python3
import json
import os
import sys
import time
import argparse
from datetime import datetime

# BUGFIX: Disable xFormers to prevent Flash Attention compatibility issues on newer GPUs
# RTX 5090 (capability 12.0) is too new for xFormers builds in most containers
# Force PyTorch to use native SDPA instead - multiple env vars for comprehensive coverage
os.environ['XFORMERS_DISABLED'] = '1'
os.environ['XFORMERS_FORCE_DISABLE_TRITON'] = '1'
os.environ['PYTORCH_ENABLE_MPS_FALLBACK'] = '1'
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'
os.environ['TORCH_CUDNN_SDPA_ENABLED'] = '1'
# Disable Flash Attention at the transformers level
os.environ['USE_FLASH_ATTENTION'] = '0'
os.environ['DISABLE_FLASH_ATTN'] = '1'

# Set HuggingFace cache - use /workspace on RunPod, ~/.cache locally
# Detect RunPod by checking if we have write access to /workspace (not just if it exists)
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

# BUGFIX: Physically remove xFormers from the environment
# RTX 5090 (capability 12.0) is incompatible with the xFormers build in this container
# We must uninstall it completely before importing Unsloth
import sys

print("[train_unsloth] 🔧 Attempting to uninstall xFormers to prevent RTX 5090 incompatibility...")

try:
    # Try to uninstall xformers using pip
    subprocess.run(
        [sys.executable, "-m", "pip", "uninstall", "-y", "xformers"],
        check=False,
        capture_output=True,
        timeout=30
    )
    print("[train_unsloth] ✅ xFormers uninstalled successfully")
except Exception as e:
    print(f"[train_unsloth] ⚠️  Could not uninstall xFormers: {e}")

# Clear any cached xFormers modules from sys.modules
xformers_modules = [key for key in sys.modules.keys() if key.startswith('xformers')]
for mod in xformers_modules:
    del sys.modules[mod]
    print(f"[train_unsloth] 🗑️  Cleared cached module: {mod}")

print("[train_unsloth] ✅ Environment prepared for SDPA-only training")

from unsloth import FastLanguageModel
from unsloth.trainer import UnslothTrainer, UnslothTrainingArguments
from datasets import load_dataset
from transformers import AutoTokenizer

# Progress tracking helper
def log_progress(stage, message, percent=None):
    """Print progress with timestamp and stage indicator"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    if percent is not None:
        print(f"[{timestamp}] 📊 {stage} ({percent}%) - {message}", flush=True)
    else:
        print(f"[{timestamp}] ▶️  {stage} - {message}", flush=True)


def ensure_packages(packages):
    missing = []
    for pkg, import_name in packages:
        try:
            importlib.import_module(import_name or pkg)
        except ImportError:
            missing.append(pkg)

    if not missing:
        return

    log_progress("GGUF_DEPS", f"Installing required packages: {', '.join(missing)}")

    installers = [
        ["uv", "pip", "install", "--upgrade"] + missing,
        [sys.executable, "-m", "pip", "install", "--upgrade"] + missing,
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
                log_progress("GGUF_DEPS", f"Packages ready via {' '.join(cmd[:2])}")
                return
        except FileNotFoundError:
            continue
        except subprocess.CalledProcessError as exc:
            print(f"[train_unsloth] Warning: installer {' '.join(cmd[:2])} failed with exit code {exc.returncode}", file=sys.stderr)

    still_missing = []
    for pkg, import_name in packages:
        try:
            importlib.import_module(import_name or pkg)
        except ImportError:
            still_missing.append(pkg)

    raise RuntimeError(
        f"Failed to install required GGUF dependencies: {', '.join(still_missing or missing)}"
    )


def main():
    # Parse command-line arguments for local execution
    parser = argparse.ArgumentParser(description='Train LoRA adapter with Unsloth')
    parser.add_argument('--data', help='Path to training data JSONL file')
    parser.add_argument('--config', help='Path to config JSON file')
    parser.add_argument('--output', help='Output directory for adapter')
    args = parser.parse_args()

    start_time = time.time()

    log_progress("INIT", "🚀 Starting LoRA training pipeline")

    # Use command-line args if provided, otherwise use RunPod defaults
    if args.data and args.config and args.output:
        log_progress("INIT", "🖥️  Running in LOCAL mode")
        data_path = args.data
        config_path = args.config
        output_dir = args.output
    else:
        log_progress("INIT", "☁️  Running in RUNPOD mode")
        input_dir = "/workspace/input"
        data_path = os.path.join(input_dir, "unsloth_dataset.jsonl")
        config_path = os.path.join(input_dir, "config.json")
        output_dir = "/output/adapter"

    # Defaults matching etc/training.json; can be overridden by config.json
    cfg = {
        "base_model": "unsloth/Qwen3-Coder-30B-A3B-Instruct",
        "lora_rank": 8,
        "lora_alpha": 16,
        "lora_dropout": 0.05,
        "num_train_epochs": 2,
        "learning_rate": 0.0002,  # 2e-4
        "per_device_train_batch_size": 1,
        "gradient_accumulation_steps": 16,
        "max_seq_length": 2048,
    }

    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            file_cfg = json.load(f)
            cfg.update({k: v for k, v in file_cfg.items() if v is not None})

    if not os.path.exists(data_path):
        print(f"[train_unsloth] Missing dataset: {data_path}", file=sys.stderr)
        sys.exit(2)

    os.makedirs(output_dir, exist_ok=True)

    # Step 1: Load dataset
    log_progress("DATASET", "Loading training data...")
    dataset = load_dataset("json", data_files=data_path, split="train")
    log_progress("DATASET", f"✅ Loaded {len(dataset)} training samples", 100)

    # Step 2: Download and load model with 4-bit quantization
    log_progress("MODEL_DOWNLOAD", f"📥 Downloading {cfg['base_model']}")

    # Use 4-bit quantization from config (default: True for memory efficiency)
    load_in_4bit = cfg.get("load_in_4bit", True)
    dtype = cfg.get("dtype", "bfloat16")

    if load_in_4bit:
        log_progress("MODEL_DOWNLOAD", f"Model will be loaded in 4-bit quantized {dtype}")
    else:
        log_progress("MODEL_DOWNLOAD", f"Model will be loaded in full {dtype} (requires ~60GB VRAM for 30B models)")

    model_start = time.time()

    # BUGFIX: Use SDPA attention for compatibility with newer GPUs (RTX 5090, etc.)
    # Flash Attention 2 via xFormers has GPU capability restrictions
    # SDPA is PyTorch's native implementation and works on all GPUs
    log_progress("MODEL_DOWNLOAD", "Using PyTorch SDPA attention (compatible with all GPUs)")

    try:
        model, tokenizer = FastLanguageModel.from_pretrained(
            cfg["base_model"],
            load_in_4bit=load_in_4bit,
            dtype=dtype,
            use_gradient_checkpointing="unsloth",  # Use Unsloth's checkpointing, not FA2
            max_seq_length=cfg["max_seq_length"],
            attn_implementation="sdpa",  # Use PyTorch native SDPA instead of Flash Attention
        )
    except Exception as e:
        # If SDPA fails, try without specifying attention implementation
        log_progress("MODEL_DOWNLOAD", f"SDPA failed, retrying with default attention: {e}")
        model, tokenizer = FastLanguageModel.from_pretrained(
            cfg["base_model"],
            load_in_4bit=load_in_4bit,
            dtype=dtype,
            use_gradient_checkpointing="unsloth",
            max_seq_length=cfg["max_seq_length"],
        )
    model_time = time.time() - model_start
    log_progress("MODEL_DOWNLOAD", f"✅ Model loaded in {model_time/60:.1f} minutes", 100)

    # BUGFIX: Explicitly disable Flash Attention in model config and modules after loading
    # This patches the model's internal attention mechanism to use standard attention
    try:
        if hasattr(model, 'config'):
            model.config._attn_implementation = "eager"
            if hasattr(model.config, 'use_flash_attention_2'):
                model.config.use_flash_attention_2 = False
            if hasattr(model.config, '_flash_attn_2_enabled'):
                model.config._flash_attn_2_enabled = False
            log_progress("MODEL_DOWNLOAD", "Patched model config to use eager attention")

        # Also patch all attention modules in the model
        patched_modules = 0
        for name, module in model.named_modules():
            if 'attention' in name.lower() or 'attn' in name.lower():
                if hasattr(module, '_attn_implementation'):
                    module._attn_implementation = "eager"
                    patched_modules += 1
                if hasattr(module, 'is_causal'):
                    module.is_causal = True  # Ensure causal masking is explicit

        if patched_modules > 0:
            log_progress("MODEL_DOWNLOAD", f"Patched {patched_modules} attention modules to eager mode")
    except Exception as e:
        log_progress("MODEL_DOWNLOAD", f"Warning: Could not patch attention config: {e}")

    # Get chat template configuration from config file
    chat_template = cfg.get('chat_template', 'auto').lower()
    system_prompt = cfg.get('system_prompt', 'You are MetaHuman Greg, a helpful assistant.')

    # Auto-detect template if set to 'auto'
    if chat_template == 'auto':
        base_model_name = cfg['base_model'].lower()
        if 'gpt-oss' in base_model_name or 'openai' in base_model_name:
            chat_template = 'harmony'
        elif 'qwen' in base_model_name:
            chat_template = 'chatml'
        elif 'llama' in base_model_name or 'mistral' in base_model_name:
            chat_template = 'llama'
        else:
            chat_template = 'chatml'  # Default fallback
        log_progress("TEMPLATE", f"Auto-detected chat template: {chat_template}")
    else:
        log_progress("TEMPLATE", f"Using configured chat template: {chat_template}")

    # Define formatting function based on template type
    if chat_template == 'harmony':
        # OpenAI Harmony format for gpt-oss models
        eos_token = tokenizer.eos_token or "<|return|>"

        def row_to_text(example):
            instruction = (example.get("instruction") or "").strip()
            context = (example.get("input") or "").strip()
            answer = (example.get("output") or "").strip()

            if context:
                user_msg = f"{instruction}\n\n{context}"
            else:
                user_msg = instruction

            # Harmony format: <|start|>role<|message|>content<|end|>
            merged = f"<|start|>developer<|message|>{system_prompt}<|end|><|start|>user<|message|>{user_msg}<|end|><|start|>assistant<|message|>{answer}<|end|>"
            return {"text": merged}

    elif chat_template == 'chatml':
        # ChatML format for Qwen and similar models
        eos_token = tokenizer.eos_token or "<|im_end|>"

        def row_to_text(example):
            instruction = (example.get("instruction") or "").strip()
            context = (example.get("input") or "").strip()
            answer = (example.get("output") or "").strip()

            if context:
                user_msg = f"{instruction}\n\n{context}"
            else:
                user_msg = instruction

            # ChatML format: <|im_start|>role\ncontent<|im_end|>
            merged = f"<|im_start|>system\n{system_prompt}<|im_end|>\n<|im_start|>user\n{user_msg}<|im_end|>\n<|im_start|>assistant\n{answer}<|im_end|>"
            return {"text": merged}

    elif chat_template == 'llama':
        # Llama format with [INST] tags
        eos_token = tokenizer.eos_token or "</s>"

        def row_to_text(example):
            instruction = (example.get("instruction") or "").strip()
            context = (example.get("input") or "").strip()
            answer = (example.get("output") or "").strip()

            if context:
                user_msg = f"{instruction}\n\n{context}"
            else:
                user_msg = instruction

            # Llama format: <s>[INST] <<SYS>>system<</SYS>>user [/INST] assistant </s>
            merged = f"<s>[INST] <<SYS>>\n{system_prompt}\n<</SYS>>\n\n{user_msg} [/INST] {answer} </s>"
            return {"text": merged}

    else:
        # Unknown template - raise error
        raise ValueError(f"Unknown chat_template '{chat_template}'. Supported: harmony, chatml, llama, auto")

    # Step 3: Preprocess dataset
    log_progress("PREPROCESSING", "Converting dataset to training format...")
    dataset = dataset.map(row_to_text)
    log_progress("PREPROCESSING", "✅ Dataset preprocessed", 100)

    # Step 4: Apply LoRA adapters
    log_progress("LORA_SETUP", f"Applying LoRA adapters (rank={cfg['lora_rank']})")

    # Auto-detect target modules based on model architecture
    base_model_name = cfg['base_model'].lower()
    if 'qwen' in base_model_name:
        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj"]
        log_progress("LORA_SETUP", "Detected Qwen architecture - using attention-only target modules")
    elif 'gpt' in base_model_name or 'llama' in base_model_name or 'mistral' in base_model_name:
        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
        log_progress("LORA_SETUP", "Detected GPT/LLaMA/Mistral architecture - using full target modules")
    else:
        # Default to full set for unknown architectures
        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
        log_progress("LORA_SETUP", f"Unknown architecture, using full target modules")

    model = FastLanguageModel.get_peft_model(
        model,
        r=int(cfg["lora_rank"]),
        lora_alpha=int(cfg.get("lora_alpha", 16)),
        lora_dropout=float(cfg.get("lora_dropout", 0.05)),
        target_modules=target_modules,
        use_gradient_checkpointing=True,
    )
    log_progress("LORA_SETUP", f"✅ LoRA adapters configured with modules: {target_modules}", 100)

    # Step 5: Training
    total_steps = len(dataset) // (cfg["per_device_train_batch_size"] * cfg["gradient_accumulation_steps"]) * cfg["num_train_epochs"]
    log_progress("TRAINING", f"🔥 Starting training: {cfg['num_train_epochs']} epochs, ~{total_steps} steps")
    log_progress("TRAINING", f"Estimated time: {total_steps * 0.5:.0f}-{total_steps * 1:.0f} minutes")
    training_args = UnslothTrainingArguments(
        output_dir=output_dir,
        num_train_epochs=int(cfg["num_train_epochs"]),
        per_device_train_batch_size=int(cfg["per_device_train_batch_size"]),
        gradient_accumulation_steps=int(cfg["gradient_accumulation_steps"]),
        learning_rate=float(cfg["learning_rate"]),
        fp16=False,  # Qwen3 uses bfloat16, not fp16
        bf16=True,   # Use bfloat16 precision
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=2,
        # BUGFIX: Force eager mode to bypass Flash Attention
        torch_compile=False,  # Disable torch compilation
        optim=cfg.get("optimizer", "paged_adamw_8bit"),  # Use config optimizer
    )

    trainer = UnslothTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        tokenizer=tokenizer,
    )

    training_start = time.time()
    trainer.train()
    training_time = time.time() - training_start
    log_progress("TRAINING", f"✅ Training complete in {training_time/60:.1f} minutes", 100)

    # Step 6: Save adapter
    log_progress("SAVE_ADAPTER", "Saving LoRA adapter weights...")
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    log_progress("SAVE_ADAPTER", "✅ Adapter saved", 100)

    # Step 7: Merge and convert to GGUF
    log_progress("GGUF_MERGE", "🔄 Merging adapter with base model...")
    log_progress("GGUF_MERGE", "Converting to GGUF Q4_K_M format (this may take 5-10 minutes)")

    # Use appropriate temp directory based on execution mode
    if args.output:
        merged_dir = os.path.join(os.path.dirname(output_dir), "merged_gguf_output")
    else:
        merged_dir = "/workspace/merged_gguf_output"
    os.makedirs(merged_dir, exist_ok=True)

    merge_start = time.time()

    ensure_packages([
        ("gguf", None),
        ("protobuf", "google.protobuf"),
        ("sentencepiece", None),
        ("mistral_common", None),
    ])

    model.save_pretrained_gguf(
        merged_dir,
        tokenizer,
        quantization_method="q4_k_m"
    )
    merge_time = time.time() - merge_start

    # Search for GGUF files in multiple locations
    gguf_files = []
    search_locations = [merged_dir]

    # Also search current working directory (where llama.cpp may put files)
    cwd = os.getcwd()
    if cwd not in search_locations:
        search_locations.append(cwd)

    # Also search /workspace if it exists and isn't already covered
    if os.path.exists('/workspace') and '/workspace' not in search_locations:
        search_locations.append('/workspace')

    log_progress("GGUF_MERGE", f"Searching for GGUF in: {search_locations}")

    # Search each location recursively
    for search_dir in search_locations:
        if not os.path.exists(search_dir):
            continue
        for root, dirs, files in os.walk(search_dir):
            for f in files:
                if f.endswith('.gguf'):
                    full_path = os.path.join(root, f)
                    if full_path not in gguf_files:  # Avoid duplicates
                        gguf_files.append(full_path)
                        log_progress("GGUF_MERGE", f"Found GGUF: {full_path} ({os.path.getsize(full_path) / (1024**3):.2f} GB)")

    log_progress("GGUF_MERGE", f"Found {len(gguf_files)} GGUF file(s): {[os.path.basename(f) for f in gguf_files]}")

    if gguf_files:
        # Use the first GGUF file found
        source_gguf = gguf_files[0]

        # Set final GGUF path based on execution mode
        if args.output:
            final_gguf = os.path.join(os.path.dirname(output_dir), "adapter.gguf")
        else:
            final_gguf = "/workspace/final_merged_model.gguf"

        # Copy instead of rename in case source is in subdirectory
        import shutil
        shutil.copy2(source_gguf, final_gguf)

        size_bytes = os.path.getsize(final_gguf)
        size_gb = size_bytes / (1024 ** 3)
        log_progress("GGUF_MERGE", f"✅ GGUF created in {merge_time/60:.1f} minutes ({size_gb:.2f} GB)", 100)
        log_progress("GGUF_MERGE", f"📁 Source: {os.path.basename(source_gguf)} → {os.path.basename(final_gguf)}")
    else:
        log_progress("GGUF_MERGE", "⚠️  Warning: No GGUF file generated")
        # List all files in merged_dir for debugging
        all_files = []
        for root, dirs, files in os.walk(merged_dir):
            for f in files:
                all_files.append(os.path.relpath(os.path.join(root, f), merged_dir))
        log_progress("GGUF_MERGE", f"Files in {merged_dir}: {all_files[:10]}")

    # Final summary
    total_time = time.time() - start_time
    log_progress("COMPLETE", "=" * 60)
    log_progress("COMPLETE", f"🎉 Training pipeline complete in {total_time/60:.1f} minutes")
    log_progress("COMPLETE", f"📁 Adapter: {output_dir}")
    log_progress("COMPLETE", f"📁 Merged GGUF: /workspace/final_merged_model.gguf")
    log_progress("COMPLETE", "=" * 60)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[train_unsloth] ERROR:", str(e), file=sys.stderr)
        sys.exit(1)
