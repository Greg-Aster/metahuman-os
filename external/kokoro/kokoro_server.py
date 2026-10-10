#!/usr/bin/env python3
"""
Kokoro TTS FastAPI Server for MetaHuman OS
Provides HTTP endpoints for text-to-speech synthesis
"""
import argparse
import io
import os
from pathlib import Path
from threading import Lock
from typing import Optional

import soundfile as sf
import numpy as np
import onnxruntime as ort
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from kokoro import KPipeline
from kokoro_onnx import Kokoro
from server_defaults import SynthesisDefaults, load_synthesis_defaults

app = FastAPI(title="Kokoro TTS Server")

# KPipeline is used only for pronunciation; ONNX owns all model inference.
pipeline: Optional[KPipeline] = None
model: Optional[Kokoro] = None
MODEL_DIR = Path(__file__).resolve().parent / "models"
synthesis_lock = Lock()
voices_dir: Optional[Path] = None
synthesis_defaults = SynthesisDefaults()
processing_device = "cpu"
requested_device = "cpu"
fallback_reason: Optional[str] = None


def load_model(device: str) -> Kokoro:
    provider = {"cpu": "CPUExecutionProvider", "cuda": "CUDAExecutionProvider"}[device]
    if provider not in ort.get_available_providers():
        raise RuntimeError(f"Kokoro {device} requires ONNX Runtime provider {provider}; run bin/install-kokoro.sh --device {device}")
    model_path = MODEL_DIR / "kokoro-v1.0.onnx"
    voices_path = MODEL_DIR / "voices-v1.0.bin"
    if not model_path.is_file() or not voices_path.is_file():
        raise RuntimeError("Kokoro ONNX assets are missing; run bin/install-kokoro.sh")
    threads = int(os.environ.get("OMP_NUM_THREADS", "2"))
    if threads < 1:
        raise ValueError("OMP_NUM_THREADS must be a positive integer")
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    options.add_session_config_entry("session.inter_op.allow_spinning", "0")
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=[provider])
    if session.get_providers()[0] != provider:
        raise RuntimeError(f"Kokoro could not activate the requested {provider}")
    session.disable_fallback()
    return Kokoro.from_session(session, str(voices_path))


def load_selected_model(device: str) -> tuple[Kokoro, str, Optional[str]]:
    if device != "auto":
        return load_model(device), device, None

    try:
        return load_model("cuda"), "cuda", None
    except Exception as error:
        print(f"[Kokoro Server] CUDA unavailable; using CPU: {error}")
        cpu_model = load_model("cpu")
        return cpu_model, "cpu", "cuda_initialization_failed"


def is_cuda_runtime_failure(error: Exception) -> bool:
    message = str(error).lower()
    return "cuda" in message or "cudnn" in message or "out of memory" in message


def load_frontend(lang_code: str) -> KPipeline:
    return KPipeline(lang_code=lang_code, model=False, repo_id="hexgrad/Kokoro-82M")


def load_custom_voicepack(filename: str) -> np.ndarray:
    pack = torch.load(filename, map_location="cpu", weights_only=True)
    if not isinstance(pack, torch.Tensor):
        raise ValueError("Custom Kokoro voicepack must contain a tensor")
    style = pack.detach().cpu().numpy().astype(np.float32)
    if style.ndim != 3 or style.shape[1:] != (1, 256) or style.shape[0] < 510 or not np.isfinite(style).all():
        raise ValueError("Custom Kokoro voicepack must contain finite voice styles shaped (510 or more, 1, 256)")
    return style


class SynthesizeRequest(BaseModel):
    text: str
    lang_code: str = "a"
    voice: str = "af_heart"
    speed: float = 1.0
    custom_voicepack: Optional[str] = None
    normalize: bool = False


@app.on_event("startup")
async def startup():
    """Initialize one ONNX model and a pronunciation-only frontend."""
    global pipeline, model, voices_dir, synthesis_defaults, processing_device, requested_device, fallback_reason
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", help="Default language code override")
    parser.add_argument("--voices-dir", type=Path, help="Custom voices directory")
    parser.add_argument("--port", type=int, default=9882)
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda", "auto"])
    args, _ = parser.parse_known_args()

    voices_dir = args.voices_dir
    synthesis_defaults = load_synthesis_defaults()
    requested_device = args.device
    lang_code = args.lang or synthesis_defaults.lang_code
    model, processing_device, fallback_reason = load_selected_model(requested_device)
    pipeline = load_frontend(lang_code)
    print(f"✓ Kokoro ONNX initialized (lang_code={lang_code}, device={processing_device})")
    print(
        "✓ Kokoro server defaults loaded "
        f"(voice={synthesis_defaults.voice}, speed={synthesis_defaults.speed}, "
        f"custom_voicepack={synthesis_defaults.custom_voicepack is not None})"
    )


@app.get("/health")
async def health():
    """Health check endpoint"""
    if pipeline is None or model is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    return {
        "status": "ok",
        "engine": "onnx",
        "device": processing_device,
        "requested_device": requested_device,
        "fallback_reason": fallback_reason,
        "lang": pipeline.lang_code if hasattr(pipeline, 'lang_code') else "unknown",
        "voices_dir": str(voices_dir) if voices_dir else None,
        "defaults": {
            "voice": synthesis_defaults.voice,
            "speed": synthesis_defaults.speed,
            "custom_voicepack": synthesis_defaults.custom_voicepack is not None,
            "normalize": synthesis_defaults.normalize,
        },
    }


def render_speech(
    text: str,
    *,
    lang_code: str,
    voice: str,
    speed: float,
    custom_voicepack: Optional[str],
    normalize: bool,
) -> bytes:
    global pipeline, model, processing_device, fallback_reason
    if pipeline is None or model is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    print("[Kokoro Server] Synthesize request:")
    print(f"  text: {text[:50]}...")
    print(f"  voice: {voice}")
    print(f"  custom_voicepack: {custom_voicepack is not None}")
    print(f"  lang_code: {lang_code}")
    print(f"  speed: {speed}")
    print(f"  normalize: {normalize}")

    # Keep pronunciation and inference serialized while health stays responsive.
    with synthesis_lock:
        if pipeline.lang_code != lang_code:
            pipeline = load_frontend(lang_code)
        voice_to_use = load_custom_voicepack(custom_voicepack) if custom_voicepack else voice
        audio_chunks = []
        for result in pipeline(text, split_pattern=None):
            try:
                audio, sample_rate = model.create(
                    result.phonemes, voice=voice_to_use, speed=speed,
                    is_phonemes=True, trim=False, sentence_pause=0, clause_pause=0,
                )
            except Exception as error:
                if requested_device != "auto" or processing_device != "cuda" or not is_cuda_runtime_failure(error):
                    raise
                print(f"[Kokoro Server] CUDA inference failed; using CPU until restart: {error}")
                cpu_model = load_model("cpu")
                model = cpu_model
                processing_device = "cpu"
                fallback_reason = "cuda_inference_failed"
                audio, sample_rate = model.create(
                    result.phonemes, voice=voice_to_use, speed=speed,
                    is_phonemes=True, trim=False, sentence_pause=0, clause_pause=0,
                )
            if sample_rate != 24000 or not len(audio) or not np.isfinite(audio).all():
                raise ValueError("Kokoro ONNX produced invalid audio")
            audio_chunks.append(audio)
    if not audio_chunks:
        raise ValueError("Kokoro produced no audio")

    audio = np.concatenate(audio_chunks) if len(audio_chunks) > 1 else audio_chunks[0]
    if normalize:
        max_val = np.abs(audio).max()
        if max_val > 0:
            target_peak = 0.707
            gain = target_peak / max_val
            audio = audio * gain
            print(f"[Kokoro Server] Applied normalization: gain={gain:.3f}x")

    buffer = io.BytesIO()
    sf.write(buffer, audio, 24000, format='WAV')
    buffer.seek(0)
    print(f"[Kokoro Server] Successfully generated {len(audio)} samples")
    return buffer.read()


@app.post("/synthesize")
def synthesize(request: SynthesizeRequest):
    """Synthesize speech using request-provided settings."""
    try:
        audio = render_speech(
            request.text,
            lang_code=request.lang_code,
            voice=request.voice,
            speed=request.speed,
            custom_voicepack=request.custom_voicepack,
            normalize=request.normalize,
        )
        return Response(content=audio, media_type="audio/wav")

    except Exception as e:
        import traceback
        print(f"[Kokoro Server] ERROR: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")


class DefaultSynthesizeRequest(BaseModel):
    text: str


@app.post("/synthesize-default")
def synthesize_default(request: DefaultSynthesizeRequest):
    """Synthesize speech using the voice preset loaded when the server started."""
    try:
        audio = render_speech(
            request.text,
            lang_code=synthesis_defaults.lang_code,
            voice=synthesis_defaults.voice,
            speed=synthesis_defaults.speed,
            custom_voicepack=synthesis_defaults.custom_voicepack,
            normalize=synthesis_defaults.normalize,
        )
        return Response(content=audio, media_type="audio/wav")
    except Exception as e:
        import traceback
        print(f"[Kokoro Server] DEFAULT SYNTHESIS ERROR: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9882)
    parser.add_argument("--lang")
    parser.add_argument("--voices-dir", type=Path)
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda", "auto"])
    args = parser.parse_args()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="info"
    )
