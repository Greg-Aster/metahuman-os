#!/usr/bin/env python3
"""Merge a PEFT LoRA into its exact base and export a Q4_K_M language GGUF and the unchanged base vision projector."""

import argparse
import gc
import os
import shutil
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("UNSLOTH_COMPILE_DISABLE", "1")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--lora-only", action="store_true")
    arguments = parser.parse_args()

    adapter_path = Path(arguments.adapter).resolve()
    output_path = Path(arguments.output).resolve()
    if not (adapter_path / "adapter_model.safetensors").is_file():
        raise FileNotFoundError(f"Missing adapter weights: {adapter_path}")
    output_path.mkdir(parents=True, exist_ok=True)
    final_gguf = output_path / "merged-gguf-no-mtp.Q4_K_M.gguf"
    projector_gguf = output_path / "mmproj-base.BF16.gguf"
    lora_directory = output_path / "adapter-gguf"
    if arguments.lora_only and list(lora_directory.glob("*.gguf")):
        print(f"GGUF LoRA already exists: {lora_directory}")
        return
    if not arguments.lora_only and final_gguf.is_file() and projector_gguf.is_file() and list(lora_directory.glob("*.gguf")):
        print(f"Merged language GGUF and base projector already exist: {final_gguf}")
        return

    import unsloth
    from unsloth import FastModel
    import torch
    from huggingface_hub import hf_hub_download, snapshot_download
    from peft import PeftConfig
    from unsloth_zoo.llama_cpp import LLAMA_CPP_DEFAULT_DIR

    del unsloth

    base_model = PeftConfig.from_pretrained(str(adapter_path)).base_model_name_or_path
    base_path = Path(snapshot_download(base_model, local_files_only=True))
    lora_converter = Path(LLAMA_CPP_DEFAULT_DIR).with_name("llama.cpp-source") / "convert_lora_to_gguf.py"
    if not lora_converter.is_file():
        raise FileNotFoundError(f"Install the llama.cpp source converter before exporting: {lora_converter}")
    lora_directory.mkdir(exist_ok=True)
    subprocess.run([
        sys.executable, str(lora_converter), str(adapter_path),
        "--base", str(base_path), "--outtype", "f16", "--outfile", str(lora_directory / "adapter.F16.gguf"),
    ], check=True)
    if arguments.lora_only:
        return

    merged_index = output_path / "model.safetensors.index.json"
    if not merged_index.is_file():
        model, tokenizer = FastModel.from_pretrained(
            str(adapter_path),
            max_seq_length=4096,
            text_only=True,
            device_map="cpu",
            dtype=torch.bfloat16,
            load_in_4bit=False,
            load_in_16bit=True,
            full_finetuning=False,
            attn_implementation="sdpa",
        )
        # Merge the weights already loaded from the cached exact base. PEFT does
        # not need a second Hub lookup or a GPU allocation for this transformation.
        merged = model.merge_and_unload()
        merged.save_pretrained(str(output_path), safe_serialization=True, max_shard_size="1GB")
        tokenizer.save_pretrained(str(output_path))
        del merged
        del model
        del tokenizer
        gc.collect()
        torch.cuda.empty_cache()
    else:
        print(f"Resuming from merged BF16 checkpoint: {output_path}")

    for filename in (
        "preprocessor_config.json",
        "processor_config.json",
        "video_preprocessor_config.json",
    ):
        source = hf_hub_download(base_model, filename=filename)
        shutil.copy2(source, output_path / filename)

    quantizer = Path(LLAMA_CPP_DEFAULT_DIR) / "llama-quantize"
    converter = Path(LLAMA_CPP_DEFAULT_DIR) / "unsloth_convert_hf_to_gguf.py"
    if not converter.is_file():
        raise FileNotFoundError(f"Unsloth GGUF converter is unavailable: {converter}")
    if not Path(quantizer).is_file():
        raise FileNotFoundError(f"llama.cpp quantizer is unavailable: {quantizer}")

    temporary_bf16 = output_path / "merged-gguf-no-mtp.BF16.gguf"
    subprocess.run([
        sys.executable,
        str(converter),
        "--outfile", str(temporary_bf16),
        "--outtype", "bf16",
        "--no-mtp",
        "--split-max-size", "50G",
        str(output_path),
    ], check=True)
    subprocess.run([
        str(quantizer),
        str(temporary_bf16),
        str(final_gguf),
        "Q4_K_M",
    ], check=True)
    temporary_bf16.unlink()
    # Language-only LoRA training leaves the base vision tower unchanged. Export
    # that exact tower separately so serving can retain multimodal inputs.
    subprocess.run([
        sys.executable, str(converter), "--mmproj", "--outfile", str(projector_gguf),
        "--outtype", "bf16", str(base_path),
    ], check=True)
    if not projector_gguf.is_file():
        raise FileNotFoundError(f"Projector export did not produce {projector_gguf}")


if __name__ == "__main__":
    main()
