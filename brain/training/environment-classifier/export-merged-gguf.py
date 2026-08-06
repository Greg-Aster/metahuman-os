#!/usr/bin/env python3
"""Merge the scored classifier LoRA into its exact base and export Q4_K_M GGUF."""

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
    arguments = parser.parse_args()

    adapter_path = Path(arguments.adapter).resolve()
    output_path = Path(arguments.output).resolve()
    if not (adapter_path / "adapter_model.safetensors").is_file():
        raise FileNotFoundError(f"Missing scored adapter weights: {adapter_path}")
    output_path.mkdir(parents=True, exist_ok=True)
    final_gguf = output_path / "merged-gguf-no-mtp.Q4_K_M.gguf"
    if final_gguf.is_file():
        print(f"Merged text-only GGUF already exists: {final_gguf}")
        return

    import torch
    from huggingface_hub import hf_hub_download
    import unsloth
    from unsloth import FastModel
    from peft import PeftConfig
    from unsloth_zoo.llama_cpp import LLAMA_CPP_DEFAULT_DIR, install_llama_cpp

    del unsloth

    merged_index = output_path / "model.safetensors.index.json"
    if not merged_index.is_file():
        model, tokenizer = FastModel.from_pretrained(
            str(adapter_path),
            max_seq_length=2048,
            dtype=torch.bfloat16,
            load_in_4bit=False,
            load_in_16bit=True,
            full_finetuning=False,
            attn_implementation="sdpa",
        )
        model.save_pretrained_merged(
            str(output_path),
            tokenizer,
            save_method="merged_16bit",
            maximum_memory_usage=0.75,
        )
        del model
        del tokenizer
        gc.collect()
        torch.cuda.empty_cache()
    else:
        print(f"Resuming from merged BF16 checkpoint: {output_path}")

    base_model = PeftConfig.from_pretrained(str(adapter_path)).base_model_name_or_path
    for filename in (
        "preprocessor_config.json",
        "processor_config.json",
        "video_preprocessor_config.json",
    ):
        source = hf_hub_download(base_model, filename=filename)
        shutil.copy2(source, output_path / filename)

    quantizer, _ = install_llama_cpp(print_output=True)
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


if __name__ == "__main__":
    main()
