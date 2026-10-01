"""Local, CPU-only Kitten Micro inference. No model downloads at runtime."""
import json
import os
from pathlib import Path

import numpy as np
import onnxruntime as ort
from kittentts.onnx_model import KittenTTS_1_Onnx

VOICES = ("Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo")
SAMPLE_RATE = 24000


def load_model(directory=None):
    root = Path(directory) if directory else Path(__file__).parent / "models"
    config = json.loads((root / "config.json").read_text())
    aliases = config["voice_aliases"]
    if set(aliases) != set(VOICES):
        raise ValueError("Kitten voice bundle must contain all eight supported voices")
    model_path = root / config["model_file"]
    voices_path = root / config["voices"]
    threads = int(os.environ.get("OMP_NUM_THREADS", "2"))
    if threads < 1:
        raise ValueError("OMP_NUM_THREADS must be positive")
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    options.add_session_config_entry("session.inter_op.allow_spinning", "0")
    model = KittenTTS_1_Onnx(
        str(model_path), str(voices_path),
        speed_priors=config.get("speed_priors", {}), voice_aliases=aliases,
    )
    # The pinned 0.8.1 constructor has no SessionOptions argument. Retire its
    # initialization session before serving; only this bounded CPU session runs.
    model.session = ort.InferenceSession(
        str(model_path), sess_options=options, providers=["CPUExecutionProvider"],
    )
    model.session.disable_fallback()
    if model.session.get_providers() != ["CPUExecutionProvider"]:
        raise RuntimeError("Kitten did not select CPUExecutionProvider")
    for voice in VOICES:
        if aliases[voice] not in model.voices:
            raise ValueError(f"Missing Kitten voice: {voice}")
    return model


def synthesize(model, text, voice="Jasper", speed=1.0):
    if voice not in VOICES:
        raise ValueError(f"Unknown Kitten voice: {voice}")
    audio = np.asarray(model.generate(text, voice=voice, speed=speed, clean_text=True)).reshape(-1)
    if audio.size == 0 or not np.isfinite(audio).all():
        raise RuntimeError("Kitten returned empty or invalid audio")
    return audio
