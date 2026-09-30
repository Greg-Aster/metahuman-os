import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("train_unsloth", Path(__file__).with_name("train_unsloth.py"))
trainer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(trainer)


class TextTokenizer:
    """A token-visible template fixture with native EOS and no implicit BOS."""
    chat_template = "fixture-native-template"
    eos_token_id = ord("~")

    def apply_chat_template(self, messages, *, tokenize, add_generation_prompt, enable_thinking):
        assert not tokenize and not enable_thinking
        text = "".join("[" + row["role"] + "]" + row["content"] + "~" for row in messages)
        return text + ("[assistant]" if add_generation_prompt else "")

    def __call__(self, text, *, add_special_tokens):
        assert not add_special_tokens
        return {"input_ids": [ord(char) for char in text]}


def config():
    return {"base_model": "fixture/model", "num_train_epochs": 1,
            "per_device_train_batch_size": 1, "gradient_accumulation_steps": 1,
            "max_seq_length": 256, "learning_rate": 0.001,
            "lora_rank": 4, "lora_alpha": 8, "load_in_4bit": False, "load_in_16bit": True}


def example(source, target="The recorded answer."):
    return {"id": source, "messages": [
        {"role": "user", "content": "User: literal text in a question."},
        {"role": "assistant", "content": target}], "metadata": {
            "sourceIds": [source], "sourceHashes": {source: "a" * 64},
            "objective": "assistant-continuation"}}


class TrainerContractTest(unittest.TestCase):
    def test_only_final_response_and_native_eos_receive_loss(self):
        row = example("source")
        row["messages"][:0] = [
            {"role": "system", "content": "Persona context."},
            {"role": "user", "content": "Earlier question."},
            {"role": "assistant", "content": "Earlier answer."},
        ]
        tokenized = trainer.tokenize_row(TextTokenizer(), row, 512)
        supervised = "".join(chr(label) for label in tokenized["labels"] if label != -100)
        self.assertEqual(supervised, "The recorded answer.~")
        self.assertIn("User: literal text", "".join(chr(token) for token in tokenized["input_ids"]))
        self.assertEqual(len(tokenized["input_ids"]), len(tokenized["labels"]))
        self.assertEqual(tokenized["attention_mask"], [1] * len(tokenized["labels"]))

    def test_no_template_unknown_boundary_missing_eos_or_truncation_is_accepted(self):
        tokenizer = TextTokenizer()
        tokenizer.chat_template = None
        with self.assertRaisesRegex(ValueError, "no native"):
            trainer.tokenize_row(tokenizer, example("source"), 256)
        tokenizer.chat_template = "native"
        with self.assertRaisesRegex(ValueError, "exceeding"):
            trainer.tokenize_row(tokenizer, example("source"), 10)
        tokenizer.eos_token_id = 9000
        with self.assertRaisesRegex(ValueError, "end-of-turn"):
            trainer.tokenize_row(tokenizer, example("source"), 256)
        tokenizer = TextTokenizer()
        original = tokenizer.apply_chat_template
        tokenizer.apply_chat_template = lambda messages, **kwargs: ("wrong" if kwargs["add_generation_prompt"] else "") + original(messages, **kwargs)
        with self.assertRaisesRegex(ValueError, "boundary"):
            trainer.tokenize_row(tokenizer, example("source"), 256)

    def test_exact_action_selector_contract_and_no_legacy_formatter(self):
        row = {"system": "  Exact system\n", "user": "Exact user", "output": '{"action":"wait"}'}
        self.assertEqual(trainer.row_messages(row, True)[0]["content"], row["system"])
        labels = trainer.tokenize_row(TextTokenizer(), row, 256, True)["labels"]
        self.assertEqual("".join(chr(label) for label in labels if label != -100), row["output"] + "~")
        with self.assertRaisesRegex(ValueError, "chronological messages"):
            trainer.row_messages({"instruction": "x", "input": "y", "output": "z"})
        with self.assertRaisesRegex(ValueError, "Exact|exact"):
            trainer.row_messages({"system": "", "user": "q", "output": "a"}, True)

    def test_malformed_roles_and_empty_targets_are_rejected(self):
        for messages in ([{"role": "assistant", "content": "a"}],
                         [{"role": "user", "content": "q"}, {"role": "assistant", "content": ""}],
                         [{"role": "assistant", "content": "a"}, {"role": "user", "content": "q"}],
                         [{"role": "user", "content": "q"}, {"role": "system", "content": "a"}]):
            with self.assertRaises(ValueError):
                trainer.row_messages({"messages": messages})

    def test_configuration_fails_instead_of_clamping_or_using_manual_templates(self):
        self.assertEqual(trainer.validate_config(config()), config())
        for update in ({"learning_rate": float("nan")}, {"learning_rate": 0},
                       {"num_train_epochs": True}, {"load_in_4bit": True},
                       {"training_mode": "unknown"}, {"lora_rank": 0},
                       {"chat_template": "chatml"}, {"force_eager_attention": True},
                       {"train_on_responses_only": False}, {"require_exact_messages": True},
                       {"gguf_conversion": {"enabled": True, "quantization_type": "invented"}}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                trainer.validate_config({**config(), **update})
        full = {**config(), "training_mode": "full_finetune", "lora_rank": 0, "lora_alpha": 0}
        self.assertEqual(trainer.validate_config(full), full)
        with self.assertRaisesRegex(ValueError, "unquantized"):
            trainer.validate_config({**full, "load_in_4bit": True, "load_in_16bit": False})

    def test_manifest_binds_model_counts_objective_context_source_and_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            train, evaluation, manifest_path = root / "train.jsonl", root / "eval.jsonl", root / "manifest.json"
            train.write_text(json.dumps(example("train")) + "\n")
            evaluation.write_text(json.dumps(example("evaluation")) + "\n")
            manifest = {"version": 2, "baseModel": config()["base_model"], "supervision": "final-assistant-only",
                        "settings": {"objective": "assistant-continuation"}, "systemPrompt": None,
                        "sourceHashes": {"train": "a" * 64, "evaluation": "a" * 64},
                        "train": {"sha256": trainer.digest(train), "count": 1, "sourceIds": ["train"]},
                        "evaluation": {"sha256": trainer.digest(evaluation), "count": 1, "sourceIds": ["evaluation"]}}

            def save(value):
                value = copy.deepcopy(value)
                value["datasetId"] = hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
                manifest_path.write_text(json.dumps(value))
                return value

            expected = save(manifest)
            self.assertEqual(trainer.verify_manifest(manifest_path, train, evaluation, config()), expected)
            with self.assertRaisesRegex(ValueError, "base model"):
                trainer.verify_manifest(manifest_path, train, evaluation, {**config(), "base_model": "different"})
            for field, value in (("systemPrompt", "different context"), ("settings", {"objective": "human-continuation"}),
                                 ("train", {**manifest["train"], "count": 2}),
                                 ("sourceHashes", {"train": "b" * 64, "evaluation": "a" * 64})):
                save({**manifest, field: value})
                with self.subTest(field=field), self.assertRaises(ValueError):
                    trainer.verify_manifest(manifest_path, train, evaluation, config())
            save(manifest)
            train.write_text(train.read_text() + "\n")
            with self.assertRaisesRegex(ValueError, "checksum"):
                trainer.verify_manifest(manifest_path, train, evaluation, config())
            expected["baseModel"] = "tampered"
            manifest_path.write_text(json.dumps(expected))
            with self.assertRaisesRegex(ValueError, "identity"):
                trainer.verify_manifest(manifest_path, train, evaluation, {**config(), "base_model": "tampered"})

    def test_non_finite_evaluation_is_a_failure(self):
        for loss in (None, "1", -1, float("nan"), float("inf")):
            with self.subTest(loss=loss), self.assertRaises(ValueError):
                trainer.finite_loss({"eval_loss": loss})
        self.assertEqual(trainer.finite_loss({"eval_loss": 0.2}), 0.2)

    def test_gguf_selection_is_confined_to_requested_conversion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "unrelated.q8_0.gguf").write_bytes(b"GGUFweights")
            with self.assertRaisesRegex(ValueError, "exactly one"):
                trainer.gguf_artifact(root, "q4_k_m")
            expected = root / "candidate.Q4_K_M.gguf"
            expected.write_bytes(b"wrong")
            with self.assertRaisesRegex(ValueError, "header"):
                trainer.gguf_artifact(root, "q4_k_m")
            expected.write_bytes(b"GGUFweights")
            self.assertEqual(trainer.gguf_artifact(root, "q4_k_m"), expected)
            (root / "second.q4_k_m.gguf").write_bytes(b"GGUFweights")
            with self.assertRaisesRegex(ValueError, "exactly one"):
                trainer.gguf_artifact(root, "q4_k_m")


@unittest.skipUnless(os.environ.get("METAHUMAN_TRAINING_SMOKE_MODEL"), "Set METAHUMAN_TRAINING_SMOKE_MODEL to run the isolated GPU optimizer/reload checks")
class TrainerGpuSmokeTest(unittest.TestCase):
    def run_smoke(self, root, model, full=False):
        data = root / "train.jsonl"
        evaluation = root / "eval.jsonl"
        settings = {"objective": "assistant-continuation"}
        rows = [example("train-" + str(index), "Blue.") for index in range(4)]
        for row in rows:
            row["messages"][0]["content"] = "What color is the clear daytime sky?"
        eval_row = example("evaluation", "Blue.")
        eval_row["messages"][0]["content"] = "Name the color of a clear sky."
        data.write_text("".join(json.dumps(row) + "\n" for row in rows))
        evaluation.write_text(json.dumps(eval_row) + "\n")
        manifest = {"version": 2, "baseModel": str(model), "supervision": "final-assistant-only",
                    "settings": settings, "systemPrompt": None,
                    "train": {"sha256": trainer.digest(data), "count": len(rows), "sourceIds": [row["id"] for row in rows]},
                    "evaluation": {"sha256": trainer.digest(evaluation), "count": 1, "sourceIds": ["evaluation"]},
                    "sourceHashes": {row["id"]: "a" * 64 for row in [*rows, eval_row]}}
        manifest["datasetId"] = hashlib.sha256(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        manifest_path = root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))
        cfg = {**config(), "base_model": str(model), "training_mode": "full_finetune" if full else "lora",
               "learning_rate": 0.0002, "num_train_epochs": 1, "gguf_conversion": {"enabled": False},
               "optimizer": "adamw_torch", "seed": 42}
        config_path = root / "config.json"
        config_path.write_text(json.dumps(cfg))
        output = root / "candidate"
        environment = {**os.environ, "HF_HUB_OFFLINE": "1", "UNSLOTH_SKIP_SYSTEM_INSTALL": "1"}
        subprocess.run([sys.executable, str(Path(__file__).with_name("train_unsloth.py")),
                        "--data", str(data), "--eval-data", str(evaluation), "--manifest", str(manifest_path),
                        "--config", str(config_path), "--output", str(output)],
                       check=True, timeout=900, cwd=root, env=environment)
        result = trainer.read_json(output / "training-result.json")
        self.assertEqual(result["status"], "candidate")
        self.assertEqual(result["datasetId"], manifest["datasetId"])
        self.assertEqual(result["activation"], "not-activated")
        self.assertEqual(result["servingValidation"], "required")
        self.assertGreater(result["supervisedTokens"], 0)
        self.assertTrue(math.isfinite(result["baselineLoss"]))
        self.assertTrue(math.isfinite(result["candidateLoss"]))
        for name, checksum in result["artifacts"].items():
            self.assertEqual(trainer.digest(output / name), checksum)
        self.assertFalse((output / "model.gguf").exists())
        return output

    def test_lora_optimizer_and_serialized_reload(self):
        with tempfile.TemporaryDirectory(prefix="metahuman-lora-smoke-") as temporary:
            output = self.run_smoke(Path(temporary), os.environ["METAHUMAN_TRAINING_SMOKE_MODEL"])
            from safetensors import safe_open
            with safe_open(output / "adapter_model.safetensors", framework="pt", device="cpu") as weights:
                self.assertTrue(any(weights.get_tensor(name).abs().sum().item() > 0 for name in weights.keys() if "lora_B" in name))

    def test_full_optimizer_and_serialized_reload(self):
        # A tiny locally initialized Llama verifies the full-parameter branch
        # without spending resources fine-tuning a personal or downloaded model.
        import unsloth  # Must precede Transformers imports.
        from tokenizers import Tokenizer, models, pre_tokenizers
        from transformers import LlamaConfig, LlamaForCausalLM, PreTrainedTokenizerFast
        with tempfile.TemporaryDirectory(prefix="metahuman-full-smoke-") as temporary:
            root = Path(temporary)
            model_path = root / "base"
            vocabulary = ["<unk>", "<pad>", "</s>", "<s>", "<|user|>", "<|assistant|>", "<|system|>",
                          "What", "color", "is", "the", "clear", "daytime", "sky", "?", "Name", "of", "a", ".", "Blue"]
            backend = Tokenizer(models.WordLevel({word: index for index, word in enumerate(vocabulary)}, unk_token="<unk>"))
            backend.pre_tokenizer = pre_tokenizers.Whitespace()
            tokenizer = PreTrainedTokenizerFast(tokenizer_object=backend, unk_token="<unk>", pad_token="<pad>",
                                               eos_token="</s>", bos_token="<s>",
                                               additional_special_tokens=["<|user|>", "<|assistant|>", "<|system|>"])
            tokenizer.chat_template = "{% for message in messages %}{{ '<|' + message.role + '|>\\n' + message.content + '</s>\\n' }}{% endfor %}{% if add_generation_prompt %}{{ '<|assistant|>\\n' }}{% endif %}"
            model = LlamaForCausalLM(LlamaConfig(vocab_size=len(tokenizer), hidden_size=64, intermediate_size=128,
                num_hidden_layers=2, num_attention_heads=4, num_key_value_heads=2, max_position_embeddings=256,
                eos_token_id=tokenizer.eos_token_id, pad_token_id=tokenizer.pad_token_id, bos_token_id=tokenizer.bos_token_id))
            model.save_pretrained(model_path)
            tokenizer.save_pretrained(model_path)
            initial = trainer.digest(model_path / "model.safetensors")
            output = self.run_smoke(root, model_path, full=True)
            self.assertNotEqual(trainer.digest(output / "model.safetensors"), initial)


if __name__ == "__main__":
    unittest.main()
