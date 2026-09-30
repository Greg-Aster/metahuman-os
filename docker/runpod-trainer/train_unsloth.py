#!/usr/bin/env python3
"""Shared local/RunPod text trainer. Data policy belongs to Core's frozen dataset."""
import argparse
import gc
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import traceback

QUANTIZATIONS = {"q4_k_m", "q5_k_m", "q6_k", "q8_0", "f16", "bf16", "f32"}


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def read_json(path):
    def invalid_constant(value):
        raise ValueError("Non-finite JSON value: " + value)
    return json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=invalid_constant)


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        os.chmod(temporary, 0o600)
        json.dump(value, handle, ensure_ascii=False, allow_nan=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def log(stage, message):
    print(f"[train_unsloth] {stage}: {message}", flush=True)


def validate_config(cfg):
    if not isinstance(cfg, dict) or not isinstance(cfg.get("base_model"), str) or not cfg["base_model"].strip():
        raise ValueError("config.base_model is required")
    mode = cfg.get("training_mode", "lora")
    if mode not in ("lora", "full", "full_finetune"):
        raise ValueError("training_mode must be lora or full_finetune")
    for name, minimum, maximum in (
        ("num_train_epochs", 1, 50), ("per_device_train_batch_size", 1, 128),
        ("gradient_accumulation_steps", 1, 1024), ("max_seq_length", 128, 262144),
    ):
        if type(cfg.get(name)) is not int or not minimum <= cfg[name] <= maximum:
            raise ValueError(f"{name} must be an integer from {minimum} through {maximum}")
    rate = cfg.get("learning_rate")
    if type(rate) not in (int, float) or not math.isfinite(rate) or not 0 < rate <= 1:
        raise ValueError("learning_rate must be finite and greater than zero, at most one")
    if mode == "lora":
        for name in ("lora_rank", "lora_alpha"):
            if type(cfg.get(name)) is not int or not 1 <= cfg[name] <= 4096:
                raise ValueError(f"{name} must be a positive integer no greater than 4096")
    for name in ("load_in_4bit", "load_in_16bit"):
        if type(cfg.get(name)) is not bool:
            raise ValueError(f"{name} must be explicitly configured")
    if cfg["load_in_4bit"] == cfg["load_in_16bit"]:
        raise ValueError("Choose exactly one of load_in_4bit and load_in_16bit")
    if mode != "lora" and cfg["load_in_4bit"]:
        raise ValueError("Full fine-tuning requires unquantized weights")
    if cfg.get("dtype", "bfloat16") not in ("bfloat16", "float16", "float32"):
        raise ValueError("dtype must be bfloat16, float16, or float32")
    if cfg.get("chat_template", "native") not in ("auto", "native"):
        raise ValueError("Manual chat templates are retired; use the model's native template")
    if cfg.get("force_eager_attention"):
        raise ValueError("Runtime attention monkey-patches are retired")
    if cfg.get("train_on_responses_only", True) is not True:
        raise ValueError("Training always supervises the final response only")
    conversion = cfg.get("gguf_conversion", {"enabled": False})
    if not isinstance(conversion, dict) or type(conversion.get("enabled")) is not bool:
        raise ValueError("gguf_conversion.enabled must be a boolean")
    if conversion["enabled"] and str(conversion.get("quantization_type", "")).lower() not in QUANTIZATIONS:
        raise ValueError("Unsupported or missing GGUF quantization_type")
    if cfg.get("require_exact_messages") and cfg.get("owner") != "environment-action-selector":
        raise ValueError("Exact system/user/output records belong to the Action Selector's development pipeline")
    return cfg


def row_messages(row, exact=False):
    if not isinstance(row, dict):
        raise ValueError("Each dataset row must be an object")
    if exact:
        # A maintained caller uses this explicit contract; no generic legacy
        # instruction/input formatter or invented system prompt is accepted.
        if any(not isinstance(row.get(key), str) or not row[key].strip() for key in ("system", "user", "output")):
            raise ValueError("Action Selector records require exact system, user and output strings")
        messages = [
            {"role": "system", "content": row["system"]},
            {"role": "user", "content": row["user"]},
            {"role": "assistant", "content": row["output"]},
        ]
    else:
        messages = row.get("messages")
    if not isinstance(messages, list) or len(messages) < 2:
        raise ValueError("Each row requires chronological messages")
    roles = []
    for index, message in enumerate(messages):
        if not isinstance(message, dict) or message.get("role") not in ("system", "user", "assistant"):
            raise ValueError("Only text system, user and assistant messages are supported")
        if not isinstance(message.get("content"), str) or not message["content"].strip():
            raise ValueError("Message content must be a non-empty string")
        if message["role"] == "system" and index != 0:
            raise ValueError("A system message must be first")
        roles.append(message["role"])
    dialogue = roles[1:] if roles[0] == "system" else roles
    if dialogue != ["user" if index % 2 == 0 else "assistant" for index in range(len(dialogue))] or dialogue[-1] != "assistant":
        raise ValueError("Messages must alternate user/assistant and end in an assistant target")
    return messages


def read_rows(path, exact=False):
    rows = []
    for index, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            row_messages(row, exact)
        except (ValueError, TypeError) as error:
            raise ValueError(f"{Path(path).name} row {index + 1}: {error}") from error
        rows.append(row)
    if not rows:
        raise ValueError(f"{Path(path).name} has no examples")
    return rows


def verify_manifest(manifest_path, data_path, eval_path, cfg):
    manifest = read_json(manifest_path)
    if manifest.get("version") != 2 or manifest.get("supervision") != "final-assistant-only":
        raise ValueError("A version 2 response-only dataset manifest is required")
    if manifest.get("baseModel") != cfg["base_model"]:
        raise ValueError("The trainer base model differs from the frozen dataset")
    snapshot = {key: value for key, value in manifest.items() if key != "datasetId"}
    expected = hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    if manifest.get("datasetId") != expected:
        raise ValueError("Dataset manifest identity does not match its contents")
    identities = []
    for name, file_path in (("train", data_path), ("evaluation", eval_path)):
        if not file_path:
            raise ValueError("An independent evaluation dataset is required")
        section = manifest.get(name, {})
        if digest(file_path) != section.get("sha256"):
            raise ValueError(f"{name} dataset checksum does not match the frozen manifest")
        rows = read_rows(file_path)
        if len(rows) != section.get("count"):
            raise ValueError(f"{name} dataset count does not match the frozen manifest")
        ids = set()
        for row in rows:
            metadata = row.get("metadata", {})
            sources = metadata.get("sourceIds", [])
            if not sources or set(metadata.get("sourceHashes", {})) != set(sources):
                raise ValueError("Every example requires its exact source identities and hashes")
            if metadata.get("objective") != manifest.get("settings", {}).get("objective"):
                raise ValueError("Example objective differs from its manifest")
            if any(manifest.get("sourceHashes", {}).get(source) != metadata["sourceHashes"][source] for source in sources):
                raise ValueError("Example provenance differs from its manifest")
            context = next((message["content"] for message in row["messages"] if message["role"] == "system"), None)
            if context != manifest.get("systemPrompt"):
                raise ValueError("Example persona context differs from its manifest")
            ids.update(sources)
        if sorted(ids) != section.get("sourceIds"):
            raise ValueError(f"{name} source identities differ from the manifest")
        identities.append(ids)
    if identities[0].intersection(identities[1]):
        raise ValueError("Training and evaluation share source identities")
    return manifest


def tokenize_row(tokenizer, row, max_length, exact=False):
    messages = row_messages(row, exact)
    if not tokenizer.chat_template:
        raise ValueError("The selected tokenizer has no native chat template")
    # Tokenize the native template once. The prompt includes the native generation
    # header; only its continuation and native end-of-turn tokens receive loss.
    full = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False, enable_thinking=False)
    prefix = tokenizer.apply_chat_template(messages[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    ids = tokenizer(full, add_special_tokens=False)["input_ids"]
    prompt_ids = tokenizer(prefix, add_special_tokens=False)["input_ids"]
    if not full.startswith(prefix) or ids[:len(prompt_ids)] != prompt_ids:
        raise ValueError("The native template has no exact final-response token boundary for this example")
    if len(ids) > max_length:
        raise ValueError(f"Example has {len(ids)} tokens, exceeding max_seq_length={max_length}; increase the limit or curate a shorter example")
    if len(prompt_ids) >= len(ids):
        raise ValueError("The final response has no supervised tokens")
    if tokenizer.eos_token_id is None or tokenizer.eos_token_id not in ids[len(prompt_ids):]:
        raise ValueError("The native response does not contain the tokenizer's end-of-turn token")
    return {
        "input_ids": ids, "attention_mask": [1] * len(ids),
        "labels": [-100] * len(prompt_ids) + ids[len(prompt_ids):],
    }


def tokenize_rows(tokenizer, rows, cfg):
    output = []
    for index, row in enumerate(rows):
        try:
            output.append(tokenize_row(tokenizer, row, cfg["max_seq_length"], cfg.get("require_exact_messages", False)))
        except ValueError as error:
            raise ValueError(f"Example {row.get('id', index + 1)}: {error}") from error
    return output


def finite_loss(metrics):
    value = metrics.get("eval_loss")
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError("Evaluation did not return a finite non-negative loss")
    return float(value)


def artifact_files(output):
    output = Path(output)
    names = ["adapter_config.json", "config.json", "tokenizer_config.json", "tokenizer.json",
             "tokenizer.model", "spiece.model", "vocab.json", "vocab.txt", "merges.txt", "added_tokens.json",
             "special_tokens_map.json", "chat_template.jinja", "generation_config.json"]
    files = [output / name for name in names if (output / name).is_file()]
    files += sorted(output.glob("*.safetensors"))
    files += sorted(output.glob("*.safetensors.index.json"))
    if not any(file.suffix == ".safetensors" for file in files):
        raise ValueError("Training produced no safetensors weights")
    if not (output / "tokenizer_config.json").is_file():
        raise ValueError("Training produced no tokenizer configuration")
    return {file.name: digest(file) for file in files}


def gguf_artifact(directory, quantization):
    files = [file for file in Path(directory).rglob("*.gguf") if quantization.lower() in file.name.lower()]
    if len(files) != 1:
        raise ValueError(f"Expected exactly one fresh {quantization} GGUF artifact; found {len(files)}")
    with files[0].open("rb") as handle:
        if handle.read(4) != b"GGUF":
            raise ValueError("Converted artifact has no GGUF header")
    return files[0]


def load_runtime(cfg, model_path=None, training=False):
    # Import Unsloth before Transformers/Torch as required by its supported API.
    from unsloth import FastModel
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; repair the environment with bin/setup-local-training")
    dtype = getattr(torch, cfg.get("dtype", "bfloat16"))
    if dtype == torch.bfloat16 and not torch.cuda.is_bf16_supported():
        raise RuntimeError("This GPU does not support the configured bfloat16 training dtype")
    model, tokenizer = FastModel.from_pretrained(
        model_name=str(model_path or cfg["base_model"]),
        max_seq_length=cfg["max_seq_length"], dtype=dtype,
        load_in_4bit=cfg["load_in_4bit"], load_in_16bit=cfg["load_in_16bit"],
        full_finetuning=training and cfg.get("training_mode", "lora") != "lora",
        use_gradient_checkpointing="unsloth", text_only=True,
    )
    if training and cfg.get("training_mode", "lora") == "lora":
        model = FastModel.get_peft_model(
            model, r=cfg["lora_rank"], lora_alpha=cfg["lora_alpha"],
            lora_dropout=cfg.get("lora_dropout", 0),
            finetune_vision_layers=False, finetune_language_layers=True,
            finetune_attention_modules=True, finetune_mlp_modules=True,
            use_gradient_checkpointing="unsloth", random_state=cfg.get("seed", 42),
        )
    if tokenizer.pad_token_id is None:
        raise ValueError("The selected tokenizer must declare a padding token")
    tokenizer.padding_side = "right"
    return model, tokenizer, torch


def make_trainer(model, tokenizer, cfg, output, training, evaluation):
    from datasets import Dataset
    from transformers import Trainer, TrainingArguments, DataCollatorForSeq2Seq
    development = cfg.get("require_exact_messages", False) and bool(evaluation)
    arguments = TrainingArguments(
        output_dir=str(output),
        num_train_epochs=cfg["num_train_epochs"],
        per_device_train_batch_size=cfg["per_device_train_batch_size"],
        per_device_eval_batch_size=cfg.get("per_device_eval_batch_size", 1),
        gradient_accumulation_steps=cfg["gradient_accumulation_steps"],
        learning_rate=cfg["learning_rate"],
        bf16=cfg.get("dtype", "bfloat16") == "bfloat16",
        fp16=cfg.get("dtype", "bfloat16") == "float16",
        logging_steps=1, save_strategy="epoch" if training else "no",
        # The Action Selector's development folds select checkpoints by loss.
        # Personalization's independent evaluation never selects a checkpoint.
        eval_strategy="epoch" if development and training else "no",
        load_best_model_at_end=development and bool(training),
        metric_for_best_model="eval_loss" if development else None,
        greater_is_better=False if development else None,
        save_total_limit=cfg.get("save_total_limit", cfg["num_train_epochs"] if development else 1),
        torch_compile=False, optim=cfg.get("optimizer", "adamw_torch"),
        seed=cfg.get("seed", 42), data_seed=cfg.get("seed", 42),
        report_to="none", remove_unused_columns=True,
    )
    return Trainer(
        model=model, args=arguments, processing_class=tokenizer,
        train_dataset=Dataset.from_list(training) if training else None,
        eval_dataset=Dataset.from_list(evaluation) if evaluation else None,
        # Precomputed labels are preserved; examples are never packed together.
        data_collator=DataCollatorForSeq2Seq(tokenizer=tokenizer, label_pad_token_id=-100),
    )


def evaluate_artifact(args, cfg):
    rows = read_rows(args.eval_data, cfg.get("require_exact_messages", False))
    model, tokenizer, _ = load_runtime(cfg, args.output)
    tokens = tokenize_rows(tokenizer, rows, cfg)
    trainer = make_trainer(model, tokenizer, cfg, args.output, [], tokens)
    loss = finite_loss(trainer.evaluate())
    write_json(Path(args.output) / "artifact-evaluation.json", {
        "version": 1, "loss": loss, "evaluationSha256": digest(args.eval_data),
        "artifacts": artifact_files(args.output), "count": len(rows),
    })


def run_training(args, cfg, manifest):
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any(output.iterdir()):
        raise ValueError("The candidate output directory must be empty; use a new run")
    started = time.time()
    result = {
        "version": 1, "status": "running", "baseModel": cfg["base_model"],
        "trainingMode": cfg.get("training_mode", "lora"),
        "datasetId": manifest["datasetId"] if manifest else None,
        "configSha256": digest(args.config), "evaluationPolicy": "development" if cfg.get("require_exact_messages") else "independent",
        "activation": "not-activated",
    }
    write_json(output / "training-result.json", result)
    try:
        rows = read_rows(args.data, cfg.get("require_exact_messages", False))
        eval_rows = read_rows(args.eval_data, cfg.get("require_exact_messages", False)) if args.eval_data else []
        model, tokenizer, torch = load_runtime(cfg, training=True)
        training = tokenize_rows(tokenizer, rows, cfg)
        evaluation = tokenize_rows(tokenizer, eval_rows, cfg)
        result.update({
            "trainingSamples": len(training), "evaluationSamples": len(evaluation),
            "supervisedTokens": sum(sum(label != -100 for label in row["labels"]) for row in training),
            "templateSha256": hashlib.sha256(tokenizer.get_chat_template().encode()).hexdigest(),
            "templateOptions": {"enable_thinking": False}, "supervision": "final-assistant-only",
            "baseRevision": getattr(model.config, "_commit_hash", None),
            "packages": {name: importlib.metadata.version(name) for name in ("torch", "unsloth", "transformers", "peft")},
        })
        trainer = make_trainer(model, tokenizer, cfg, output, training, evaluation)
        baseline = finite_loss(trainer.evaluate()) if evaluation else None
        log("TRAINING", f"{len(training)} examples, {result['supervisedTokens']} supervised tokens")
        trainer.train()
        trainer.save_model(str(output))
        tokenizer.save_pretrained(output)
        artifacts = artifact_files(output)
        conversion = cfg.get("gguf_conversion", {"enabled": False})
        if conversion["enabled"] and not args.skip_gguf:
            quantization = conversion["quantization_type"].lower()
            conversion_dir = output / "gguf-conversion"
            conversion_dir.mkdir(mode=0o700)
            model.save_pretrained_gguf(str(conversion_dir), tokenizer, quantization_method=quantization)
            gguf = gguf_artifact(conversion_dir, quantization)
            destination = output / "model.gguf"
            shutil.move(str(gguf), destination)
            artifacts[destination.name] = digest(destination)
            # Conversion intermediates are inside this newly created run only.
            shutil.rmtree(conversion_dir)
        result["artifacts"] = artifacts
        # Reload the serialized candidate in a fresh process; in-memory loss is
        # not evidence that the exported weights can actually be loaded.
        del trainer, model, tokenizer
        gc.collect()
        torch.cuda.empty_cache()
        candidate = None
        if eval_rows:
            subprocess.run([
                sys.executable, str(Path(__file__).resolve()),
                "--config", str(Path(args.config).resolve()), "--output", str(output),
                "--eval-data", str(Path(args.eval_data).resolve()), "--evaluate-artifact",
            ], check=True)
            report = read_json(output / "artifact-evaluation.json")
            if report["evaluationSha256"] != digest(args.eval_data) or report["artifacts"] != artifact_files(output):
                raise ValueError("Reload evaluation does not describe these exact candidate files")
            candidate = finite_loss({"eval_loss": report["loss"]})
            result["artifacts"]["artifact-evaluation.json"] = digest(output / "artifact-evaluation.json")
        result.update({
            "status": "candidate", "baselineLoss": baseline, "candidateLoss": candidate,
            "qualityGate": "passed" if candidate is not None and baseline is not None and candidate <= baseline else
                "failed" if candidate is not None else "external-evaluation-required",
            "durationSeconds": time.time() - started,
            "servingValidation": "required",
        })
        write_json(output / "training-result.json", result)
        log("CANDIDATE", f"Saved candidate; quality gate={result['qualityGate']}; activation requires serving validation and review")
    except BaseException as error:
        result.update({"status": "failed", "error": str(error), "durationSeconds": time.time() - started})
        write_json(output / "training-result.json", result)
        raise


def check_environment():
    """The same pinned import/CUDA preflight is used locally and before remote data upload."""
    from importlib.metadata import version
    requirements = Path(__file__).with_name("requirements.txt")
    for line in requirements.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        package, expected = line.strip().split("==")
        installed = version(package).split("+")[0]
        if installed != expected:
            raise ValueError(f"{package}: expected {expected}, found {installed}; rebuild the training environment")
    import unsloth
    import torch
    if not torch.cuda.is_available():
        raise ValueError("CUDA is unavailable in the training environment")
    log("ENVIRONMENT", "Pinned packages and CUDA imports passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", help="Frozen training JSONL")
    parser.add_argument("--eval-data", help="Independent evaluation JSONL (development fold for the Action Selector)")
    parser.add_argument("--manifest", help="Version 2 dataset manifest")
    parser.add_argument("--config", help="Training configuration JSON")
    parser.add_argument("--output", help="Fresh candidate directory")
    parser.add_argument("--check-environment", action="store_true", help="Check pinned dependencies and CUDA without loading model weights")
    parser.add_argument("--skip-gguf", action="store_true", help="Produce safetensors only")
    parser.add_argument("--validate-only", action="store_true", help="Validate dataset provenance and native token labels without loading model weights")
    parser.add_argument("--evaluate-artifact", action="store_true", help="Evaluate serialized candidate weights in a fresh process")
    args = parser.parse_args()
    if args.check_environment:
        check_environment()
        return
    if not args.config or not args.output:
        parser.error("Training and artifact evaluation require --config and --output")
    cfg = validate_config(read_json(args.config))
    if args.evaluate_artifact:
        if args.validate_only or not args.eval_data or not (Path(args.output) / "training-result.json").is_file():
            parser.error("Artifact evaluation requires an existing candidate and --eval-data")
        evaluate_artifact(args, cfg)
        return
    if not args.data:
        parser.error("--data is required")
    manifest = None
    if not cfg.get("require_exact_messages", False):
        if not args.manifest or not args.eval_data:
            parser.error("Personalization requires --manifest and --eval-data")
        manifest = verify_manifest(args.manifest, args.data, args.eval_data, cfg)
    if args.validate_only:
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(cfg["base_model"])
        rows = tokenize_rows(tokenizer, read_rows(args.data, cfg.get("require_exact_messages", False)), cfg)
        evaluation = tokenize_rows(tokenizer, read_rows(args.eval_data, cfg.get("require_exact_messages", False)), cfg) if args.eval_data else []
        log("VALIDATED", f"{len(rows)} training and {len(evaluation)} evaluation examples; final response labels only")
        return
    check_environment()
    run_training(args, cfg, manifest)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
