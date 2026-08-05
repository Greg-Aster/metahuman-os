#!/usr/bin/env python3
"""Generate development predictions from one local Qwen router adapter."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

# Checkpoint evaluation favors deterministic, unbounded corpus traversal over
# Unsloth's training-oriented compiled inference cache. This supported switch
# must be set before importing Unsloth.
os.environ["UNSLOTH_COMPILE_DISABLE"] = "1"
os.environ["TORCH_COMPILE_DISABLE"] = "1"

from unsloth import FastModel
import torch


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--fold", type=int, required=True)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def prompt(record: dict[str, Any]) -> str:
    return (
        f"<|im_start|>system\n{record['system']}<|im_end|>\n"
        f"<|im_start|>user\n{record['user']}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )


def validate_records(records: list[dict[str, Any]], fold: int) -> None:
    if not records:
        raise ValueError("development validation data is empty")
    seen: set[str] = set()
    for record in records:
        metadata = record.get("metadata", {})
        record_id = metadata.get("recordId")
        if not isinstance(record_id, str) or record_id in seen:
            raise ValueError(f"invalid or duplicate record id: {record_id}")
        seen.add(record_id)
        if (
            metadata.get("sourceSplit") != "development"
            or metadata.get("systemOwned") is not True
            or metadata.get("developmentFold") != fold
        ):
            raise ValueError(f"{record_id}: checkpoint evaluation accepts only its system-owned development fold")
        expected = json.loads(record.get("output", ""))
        if not isinstance(expected, dict) or len(expected) != 14:
            raise ValueError(f"{record_id}: complete 14-field output is required")


def main() -> None:
    args = parse_args()
    data_path = Path(args.data).resolve()
    adapter_path = Path(args.adapter).resolve()
    config_path = Path(args.config).resolve()
    output_path = Path(args.output).resolve()
    config = read_json(config_path)
    records = read_jsonl(data_path)
    validate_records(records, args.fold)

    if config.get("owner") != "environment-classifier":
        raise ValueError("config owner must be environment-classifier")
    if config.get("base_model") != "unsloth/Qwen3.5-0.8B":
        raise ValueError("checkpoint evaluator is locked to the selected Qwen3.5-0.8B base")
    if not adapter_path.is_dir() or not (adapter_path / "adapter_config.json").is_file():
        raise ValueError(f"adapter checkpoint is incomplete: {adapter_path}")

    dtype = torch.bfloat16 if config.get("dtype") == "bfloat16" else torch.float16
    model, tokenizer = FastModel.from_pretrained(
        model_name=str(adapter_path),
        max_seq_length=int(config.get("max_seq_length", 1536)),
        load_in_4bit=False,
        load_in_16bit=True,
        full_finetuning=False,
        dtype=dtype,
        attn_implementation="sdpa",
    )
    FastModel.for_inference(model)
    if hasattr(model, "config"):
        model.config.use_cache = True
    tokenizer.padding_side = "left"

    batch_size = int(config.get("per_device_eval_batch_size", 8))
    max_new_tokens = int(config.get("generation_max_new_tokens", 512))
    max_sequence_length = int(config.get("max_seq_length", 1536))
    prompts = [prompt(record) for record in records]
    prompt_token_ids = tokenizer(
        prompts,
        add_special_tokens=False,
        truncation=False,
    )["input_ids"]
    prompt_width = max(len(token_ids) for token_ids in prompt_token_ids)
    if prompt_width + max_new_tokens > max_sequence_length:
        raise ValueError(
            f"prompt width {prompt_width} plus generation budget {max_new_tokens} "
            f"exceeds max sequence length {max_sequence_length}"
        )
    model_name = f"unsloth/Qwen3.5-0.8B:fold-{args.fold}:{adapter_path.name}"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for offset in range(0, len(records), batch_size):
            batch = records[offset:offset + batch_size]
            encoded = tokenizer(
                prompts[offset:offset + batch_size],
                padding="max_length",
                max_length=prompt_width,
                truncation=False,
                return_tensors="pt",
            )
            encoded = {key: value.to(model.device) for key, value in encoded.items()}
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            started = time.perf_counter()
            with torch.inference_mode():
                generated = model.generate(
                    **encoded,
                    do_sample=False,
                    max_new_tokens=max_new_tokens,
                    eos_token_id=tokenizer.eos_token_id,
                    pad_token_id=tokenizer.eos_token_id,
                )
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            latency_ms = (time.perf_counter() - started) * 1000 / len(batch)
            output_tokens = generated[:, encoded["input_ids"].shape[1]:]
            responses = tokenizer.batch_decode(output_tokens, skip_special_tokens=True)
            for record, response in zip(batch, responses, strict=True):
                metadata = record["metadata"]
                handle.write(json.dumps({
                    "model": model_name,
                    "fold": args.fold,
                    "recordId": metadata["recordId"],
                    "sourceCaseId": metadata["sourceCaseId"],
                    "suite": metadata["suite"],
                    "risk": metadata["risk"],
                    "expected": json.loads(record["output"]),
                    "rawResponse": response.strip(),
                    "meanBatchLatencyMs": latency_ms,
                    "systemOwned": True,
                }, ensure_ascii=False) + "\n")
            handle.flush()
            print(f"{adapter_path.name}: {min(offset + len(batch), len(records))}/{len(records)}", flush=True)


if __name__ == "__main__":
    main()
