"""HTTP, inference ownership and voicepack contracts without model downloads."""
import asyncio
import io
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
import soundfile as sf
import torch
import kokoro_server as server


class FakeModel:
    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.release.set()
        self.active = 0
        self.max_active = 0
        self.guard = threading.Lock()
        self.calls = []
        self.audio = np.full(240, 0.1, dtype=np.float32)

    def create(self, phonemes, **options):
        with self.guard:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            self.calls.append((phonemes, options))
        try:
            self.started.set()
            if not self.release.wait(5):
                raise RuntimeError("Fixture synthesis was not released")
            time.sleep(0.02)
            return self.audio, 24000
        finally:
            with self.guard:
                self.active -= 1


class FakeFrontend:
    def __init__(self, lang_code, **options):
        if options.get("model") is not False:
            raise AssertionError("A second speech model must never load")
        self.lang_code = lang_code

    def __call__(self, text, **options):
        yield SimpleNamespace(phonemes=f"phonemes:{self.lang_code}:{text}")


class KokoroServerTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.model = FakeModel()
        self.stack.enter_context(patch.object(server, "load_model", return_value=self.model))
        self.stack.enter_context(patch.object(server, "KPipeline", side_effect=FakeFrontend))
        self.client = self.stack.enter_context(TestClient(server.app))

    def test_health_remains_responsive_during_inference(self):
        self.model.release.clear()
        with ThreadPoolExecutor(max_workers=2) as workers:
            synthesis = workers.submit(self.client.post, "/synthesize", json={"text": "Synthetic speech."})
            try:
                self.assertTrue(self.model.started.wait(5))
                health = workers.submit(self.client.get, "/health")
                response = health.result(timeout=2)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["engine"], "onnx")
                self.assertFalse(synthesis.done())
            finally:
                self.model.release.set()
            response = synthesis.result(timeout=5)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content[:4], b"RIFF")

    def test_both_synthesis_routes_serialize_access_to_the_shared_model(self):
        with ThreadPoolExecutor(max_workers=2) as workers:
            calls = [workers.submit(self.client.post, route, json={"text": "Synthetic speech."})
                     for route in ["/synthesize", "/synthesize-default"]]
            for call in calls:
                self.assertEqual(call.result(timeout=5).status_code, 200)
        self.assertEqual(self.model.max_active, 1)

    def test_request_language_voice_speed_and_phonemes_reach_onnx(self):
        response = self.client.post("/synthesize", json={
            "text": "Synthetic speech.", "lang_code": "i", "voice": "im_nicola", "speed": 0.9,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.model.calls, [("phonemes:i:Synthetic speech.", {
            "voice": "im_nicola", "speed": 0.9, "is_phonemes": True,
            "trim": False, "sentence_pause": 0, "clause_pause": 0,
        })])
        samples, rate = sf.read(io.BytesIO(response.content))
        self.assertEqual(rate, 24000)
        self.assertGreater(np.abs(samples).max(), 0)

    def test_custom_pt_voicepacks_are_loaded_as_styles_and_normalized(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "voice.pt"
            torch.save(torch.ones((510, 1, 256)), filename)
            response = self.client.post("/synthesize", json={
                "text": "Synthetic speech.", "custom_voicepack": str(filename), "normalize": True,
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.model.calls[0][1]["voice"].shape, (510, 1, 256))
        samples, _ = sf.read(io.BytesIO(response.content))
        self.assertAlmostEqual(float(np.abs(samples).max()), 0.707, places=3)

    def test_missing_custom_voicepack_fails_instead_of_using_builtin_voice(self):
        response = self.client.post("/synthesize", json={
            "text": "Synthetic speech.", "custom_voicepack": "/missing/synthetic-voice.pt",
        })
        self.assertEqual(response.status_code, 500)
        self.assertIn("Synthesis failed", response.json()["detail"])
        self.assertEqual(self.model.calls, [])

    def test_invalid_custom_voicepack_and_nonfinite_audio_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "voice.pt"
            torch.save(torch.ones(256), filename)
            response = self.client.post("/synthesize", json={
                "text": "Synthetic speech.", "custom_voicepack": str(filename),
            })
            self.assertEqual(response.status_code, 500)
            self.assertIn("voice styles", response.json()["detail"])
        self.model.audio = np.array([np.nan], dtype=np.float32)
        response = self.client.post("/synthesize", json={"text": "Synthetic speech."})
        self.assertEqual(response.status_code, 500)
        self.assertIn("invalid audio", response.json()["detail"])

    def test_inference_failure_is_visible_and_does_not_poison_next_request(self):
        with patch.object(self.model, "create", side_effect=RuntimeError("Synthetic inference failure")):
            response = self.client.post("/synthesize", json={"text": "Synthetic speech."})
            self.assertEqual(response.status_code, 500)
            self.assertIn("Synthetic inference failure", response.json()["detail"])
        self.assertEqual(self.client.post("/synthesize", json={"text": "Synthetic speech."}).status_code, 200)


class OnnxStartupTests(unittest.TestCase):
    def test_auto_mode_prefers_cuda_and_reports_cpu_fallback(self):
        with patch.object(server, "load_model", return_value="gpu-model") as load:
            self.assertEqual(server.load_selected_model("auto"), ("gpu-model", "cuda", None))
        load.assert_called_once_with("cuda")

        def unavailable(device):
            if device == "cuda":
                raise RuntimeError("CUDAExecutionProvider unavailable")
            return "cpu-model"

        with patch.object(server, "load_model", side_effect=unavailable) as load:
            self.assertEqual(server.load_selected_model("auto"), (
                "cpu-model", "cpu", "cuda_initialization_failed"))
        self.assertEqual([call.args[0] for call in load.call_args_list], ["cuda", "cpu"])

    def test_unavailable_cuda_is_not_silently_replaced_with_cpu(self):
        with patch.object(server.ort, "get_available_providers", return_value=["CPUExecutionProvider"]):
            with self.assertRaisesRegex(RuntimeError, "CUDAExecutionProvider"):
                server.load_model("cuda")

    def test_session_fallback_is_rejected(self):
        session = Mock()
        session.get_providers.return_value = ["CPUExecutionProvider"]
        with patch.object(server.ort, "get_available_providers", return_value=["CUDAExecutionProvider"]), \
             patch.object(Path, "is_file", return_value=True), \
             patch.object(server.ort, "InferenceSession", return_value=session):
            with self.assertRaisesRegex(RuntimeError, "could not activate"):
                server.load_model("cuda")

    def test_cpu_session_uses_bounded_threads_without_spinning_or_runtime_fallback(self):
        session = Mock()
        session.get_providers.return_value = ["CPUExecutionProvider"]
        with patch.dict("os.environ", {"OMP_NUM_THREADS": "2"}), \
             patch.object(Path, "is_file", return_value=True), \
             patch.object(server.ort, "InferenceSession", return_value=session) as factory, \
             patch.object(server.Kokoro, "from_session", return_value="onnx-model"):
            self.assertEqual(server.load_model("cpu"), "onnx-model")
        options = factory.call_args.kwargs["sess_options"]
        self.assertEqual(options.intra_op_num_threads, 2)
        self.assertEqual(options.inter_op_num_threads, 1)
        self.assertEqual(options.get_session_config_entry("session.intra_op.allow_spinning"), "0")
        self.assertEqual(options.get_session_config_entry("session.inter_op.allow_spinning"), "0")
        session.disable_fallback.assert_called_once()


class AutoDeviceTests(unittest.TestCase):
    def setUp(self):
        self.previous = (
            server.pipeline, server.model, server.requested_device,
            server.processing_device, server.fallback_reason,
        )
        self.addCleanup(self.restore_state)
        server.pipeline = FakeFrontend("a", model=False)
        server.requested_device = "auto"
        server.processing_device = "cuda"

    def restore_state(self):
        (server.pipeline, server.model, server.requested_device,
         server.processing_device, server.fallback_reason) = self.previous

    def test_cuda_inference_failure_switches_to_cpu_for_later_requests(self):
        gpu = Mock()
        gpu.create.side_effect = RuntimeError("CUDA out of memory")
        cpu = Mock()
        cpu.create.return_value = (np.full(240, 0.1, dtype=np.float32), 24000)
        server.model = gpu

        with patch.object(server, "load_model", return_value=cpu) as load:
            first = server.render_speech("First.", lang_code="a", voice="af_heart", speed=1,
                                         custom_voicepack=None, normalize=False)
            second = server.render_speech("Second.", lang_code="a", voice="af_heart", speed=1,
                                          custom_voicepack=None, normalize=False)
        self.assertEqual(first[:4], b"RIFF")
        self.assertEqual(second[:4], b"RIFF")
        load.assert_called_once_with("cpu")
        gpu.create.assert_called_once()
        self.assertEqual(cpu.create.call_count, 2)
        health = asyncio.run(server.health())
        self.assertEqual(health["requested_device"], "auto")
        self.assertEqual(health["device"], "cpu")
        self.assertEqual(health["fallback_reason"], "cuda_inference_failed")

    def test_non_cuda_failure_remains_visible(self):
        server.model = Mock()
        server.model.create.side_effect = RuntimeError("Invalid voice")

        with patch.object(server, "load_model") as load:
            with self.assertRaisesRegex(RuntimeError, "Invalid voice"):
                server.render_speech("Hello.", lang_code="a", voice="af_heart", speed=1,
                                     custom_voicepack=None, normalize=False)
        load.assert_not_called()
        self.assertEqual(server.processing_device, "cuda")


if __name__ == "__main__":
    unittest.main()
