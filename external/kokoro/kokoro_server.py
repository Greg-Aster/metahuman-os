#!/usr/bin/env python3
"""
Kokoro TTS FastAPI Server for MetaHuman OS
Provides HTTP endpoints for text-to-speech synthesis
"""
import argparse
import io
from pathlib import Path
from typing import Optional

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from server_defaults import SynthesisDefaults, load_synthesis_defaults

try:
    from kokoro import KPipeline
except ImportError:
    print("Error: kokoro package not found")
    print("Install with: pip install kokoro>=0.9.4")
    exit(1)

app = FastAPI(title="Kokoro TTS Server")

# Global pipeline instance
pipeline: Optional[KPipeline] = None
voices_dir: Optional[Path] = None
synthesis_defaults = SynthesisDefaults()
processing_device = "cpu"


class SynthesizeRequest(BaseModel):
    text: str
    lang_code: str = "a"
    voice: str = "af_heart"
    speed: float = 1.0
    custom_voicepack: Optional[str] = None
    normalize: bool = False


@app.on_event("startup")
async def startup():
    """Initialize Kokoro pipeline on server startup"""
    global pipeline, voices_dir, synthesis_defaults, processing_device
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", help="Default language code override")
    parser.add_argument("--voices-dir", type=Path, help="Custom voices directory")
    parser.add_argument("--port", type=int, default=9882)
    parser.add_argument("--device", default="cpu", help="Device to use: cpu or cuda")
    args, _ = parser.parse_known_args()

    voices_dir = args.voices_dir
    synthesis_defaults = load_synthesis_defaults()
    processing_device = args.device if args.device in ['cpu', 'cuda'] else 'cpu'
    lang_code = args.lang or synthesis_defaults.lang_code
    pipeline = KPipeline(lang_code=lang_code, device=processing_device)
    print(f"✓ Kokoro pipeline initialized (lang_code={lang_code}, device={processing_device})")
    print(
        "✓ Kokoro server defaults loaded "
        f"(voice={synthesis_defaults.voice}, speed={synthesis_defaults.speed}, "
        f"custom_voicepack={synthesis_defaults.custom_voicepack is not None})"
    )


@app.get("/health")
async def health():
    """Health check endpoint"""
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    return {
        "status": "ok",
        "device": processing_device,
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
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    voice_to_use = custom_voicepack if (
        custom_voicepack and Path(custom_voicepack).exists()
    ) else voice
    print("[Kokoro Server] Synthesize request:")
    print(f"  text: {text[:50]}...")
    print(f"  voice: {voice}")
    print(f"  custom_voicepack: {custom_voicepack is not None}")
    print(f"  voice_to_use: {voice_to_use}")
    print(f"  lang_code: {lang_code}")
    print(f"  speed: {speed}")
    print(f"  normalize: {normalize}")

    gen = pipeline(
        text,
        voice=voice_to_use,
        speed=speed,
        split_pattern=None
    )
    audio_chunks = [result.output.audio.cpu().numpy() for result in gen]
    if not audio_chunks:
        raise ValueError("Kokoro produced no audio")

    import numpy as np
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
async def synthesize(request: SynthesizeRequest):
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
async def synthesize_default(request: DefaultSynthesizeRequest):
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
    import sys

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9882)
    parser.add_argument("--lang")
    parser.add_argument("--voices-dir", type=Path)
    parser.add_argument("--device", default="cpu", help="Device to use: cpu or cuda")
    args = parser.parse_args()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="info"
    )
