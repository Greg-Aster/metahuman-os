"""HTTP behavior tests; real model/voice synthesis is verified by the installer."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Event
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import numpy as np
import soundfile as sf
import kitten_server as server


class KittenServerTests(unittest.TestCase):
    def setUp(self):
        self.model_patch = patch.object(server, "load_model", return_value=object())
        self.model_patch.start()
        self.client = TestClient(server.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.model_patch.stop()

    def test_health_lists_every_voice_and_cpu(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["voices"], list(server.VOICES))
        self.assertEqual(response.json()["device"], "cpu")

    def test_synthesis_returns_decodable_pcm_wav(self):
        with patch.object(server, "synthesize", return_value=np.ones(2400) * 0.1) as generate:
            response = self.client.post("/synthesize", json={"text": "Hello.", "voice": "Luna", "speed": 0.9})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/wav")
        audio, rate = sf.read(BytesIO(response.content))
        self.assertEqual(rate, 24000)
        self.assertEqual(len(audio), 2400)
        generate.assert_called_once_with(server.model, "Hello.", "Luna", 0.9)

    def test_invalid_preferences_never_infer(self):
        with patch.object(server, "synthesize") as generate:
            for body, status in [
                ({"text": "Hello.", "voice": "af_heart"}, 400),
                ({"text": "   "}, 400),
                ({"text": "Hello.", "speed": 0}, 422),
                ({"text": ""}, 422),
            ]:
                self.assertEqual(self.client.post("/synthesize", json=body).status_code, status)
            generate.assert_not_called()

    def test_inference_failure_is_visible(self):
        with patch.object(server, "synthesize", side_effect=RuntimeError("fixture inference failure")):
            response = self.client.post("/synthesize", json={"text": "Hello."})
        self.assertEqual(response.status_code, 500)

    def test_health_stays_responsive_during_inference(self):
        started, release = Event(), Event()
        def generate(*args):
            started.set()
            if not release.wait(5):
                raise RuntimeError("fixture timed out")
            return np.ones(2400) * 0.1
        with patch.object(server, "synthesize", side_effect=generate), ThreadPoolExecutor(1) as workers:
            future = workers.submit(self.client.post, "/synthesize", json={"text": "Hello."})
            try:
                self.assertTrue(started.wait(2))
                before = time.monotonic()
                self.assertEqual(self.client.get("/health").status_code, 200)
                self.assertLess(time.monotonic() - before, 0.5)
            finally:
                release.set()
            self.assertEqual(future.result(timeout=2).status_code, 200)


if __name__ == "__main__":
    unittest.main()
