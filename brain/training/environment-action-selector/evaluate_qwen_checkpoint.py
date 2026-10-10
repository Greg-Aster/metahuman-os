#!/usr/bin/env python3
"""Evaluate a specialist checkpoint or base using the same native template as training."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

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
    parser.add_argument("--fold", type=int, default=-1)
    parser.add_argument("--split", choices=["development", "evaluation", "regression"], default="development")
    parser.add_argument("--base", action="store_true")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def prompt(record: dict[str, Any], tokenizer: Any) -> str:
    return tokenizer.apply_chat_template([
        {"role": "system", "content": record["system"]},
        {"role": "user", "content": record["user"]},
    ], tokenize=False, add_generation_prompt=True, enable_thinking=False)


def validate_records(records: list[dict[str, Any]], fold: int, split: str, specialist: str) -> None:
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
            metadata.get("sourceSplit") != split
            or metadata.get("specialist") != specialist
            or metadata.get("systemOwned") is not True
            or (split == "development" and metadata.get("developmentFold") != fold)
        ):
            raise ValueError(f"{record_id}: evaluator accepts only its system-owned development fold")
        expected = json.loads(record.get("output", ""))
        if not isinstance(expected, dict):
            raise ValueError(f"{record_id}: expected structured specialist output")


def main() -> None:
    args = parse_args()
    data_path = Path(args.data).resolve()
    adapter_path = Path(args.adapter).resolve()
    config_path = Path(args.config).resolve()
    output_path = Path(args.output).resolve()
    config = read_json(config_path)
    records = read_jsonl(data_path)
    validate_records(records, args.fold, args.split, config.get("specialist"))

    if config.get("owner") != "environment-action-selector":
        raise ValueError("config owner must be environment-action-selector")
    if config.get("base_model") != "unsloth/Qwen3.5-0.8B":
        raise ValueError("evaluator is locked to the selected Qwen3.5-0.8B base")
    if not args.base and (not adapter_path.is_dir() or not (adapter_path / "adapter_config.json").is_file()):
        raise ValueError(f"adapter checkpoint is incomplete: {adapter_path}")

    dtype = torch.bfloat16 if config.get("dtype") == "bfloat16" else torch.float16
    model, tokenizer = FastModel.from_pretrained(
        model_name=config["base_model"] if args.base else str(adapter_path),
        text_only=True,
        max_seq_length=int(config.get("max_seq_length", 1536)),
        load_in_4bit=False,
        load_in_16bit=True,
        full_finetuning=False,
        dtype=dtype,
        attn_implementation="sdpa",
    )
    # The text-only loader drops the parent multimodal architecture name.
    # Unsloth generation reads this metadata; describe the actual loaded class.
    underlying = model.get_base_model() if hasattr(model, "get_base_model") else model
    model.config.architectures = [type(underlying).__name__]
    FastModel.for_inference(model)
    if hasattr(model, "config"):
        model.config.use_cache = True
    tokenizer.padding_side = "left"

    batch_size = int(config.get("generation_batch_size", 4))
    max_new_tokens = int(config.get("generation_max_new_tokens", 384))
    max_sequence_length = int(config.get("max_seq_length", 1536))
    prompts = [prompt(record, tokenizer) for record in records]
    prompt_token_ids = tokenizer(prompts, add_special_tokens=False, truncation=False)["input_ids"]
    prompt_width = max(len(token_ids) for token_ids in prompt_token_ids)
    if prompt_width + max_new_tokens > max_sequence_length:
        raise ValueError(
            f"prompt width {prompt_width} plus generation budget {max_new_tokens} "
            f"exceeds max sequence length {max_sequence_length}"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    model_name = config["base_model"] if args.base else str(adapter_path)
    with output_path.open("w", encoding="utf-8") as handle:
        for offset in range(0, len(records), batch_size):
            batch = records[offset:offset + batch_size]
            encoded = tokenizer(
                prompts[offset:offset + batch_size],
                padding=True,
                add_special_tokens=False,
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
            prompt_lengths = prompt_token_ids[offset:offset + len(batch)]
            for record, response, token_ids, input_token_ids in zip(
                batch, responses, output_tokens, prompt_lengths, strict=True
            ):
                metadata = record["metadata"]
                handle.write(json.dumps({
                    "model": model_name,
                    "provider": "transformers",
                    "fold": args.fold,
                    "sourceSplit": args.split,
                    "specialist": config["specialist"],
                    "device": str(model.device),
                    "batchSize": len(batch),
                    "user": record["user"],
                    "recordId": metadata["recordId"],
                    "sourceCaseId": metadata["sourceCaseId"],
                    "suite": metadata["suite"],
                    "risk": metadata["risk"],
                    "expected": json.loads(record["output"]),
                    "rawResponse": response.strip(),
                    "meanBatchLatencyMs": latency_ms,
                    "promptTokens": len(input_token_ids),
                    "completionTokens": int((token_ids != tokenizer.eos_token_id).sum().item()),
                    "systemOwned": True,
                }, ensure_ascii=False) + "\n")
            handle.flush()
            print(f"fold {args.fold}: {min(offset + len(batch), len(records))}/{len(records)}", flush=True)


if __name__ == "__main__":
    main()
