#!/usr/bin/env python3
"""
Kokoro TTS FastAPI Server for MetaHuman OS
Provides HTTP endpoints for text-to-speech synthesis
"""
import argparse
import io
import json
from pathlib import Path
from typing import Optional

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

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


class SynthesizeRequest(BaseModel):
    text: str
    lang_code: str = "a"
    voice: str = "af_heart"
    speed: float = 1.0
    custom_voicepack: Optional[str] = None


@app.on_event("startup")
async def startup():
    """Initialize Kokoro pipeline on server startup"""
    global pipeline, voices_dir
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", default="a", help="Default language code")
    parser.add_argument("--voices-dir", type=Path, help="Custom voices directory")
    parser.add_argument("--port", type=int, default=9882)
    args, _ = parser.parse_known_args()

    voices_dir = args.voices_dir
    pipeline = KPipeline(lang_code=args.lang)
    print(f"✓ Kokoro pipeline initialized (lang_code={args.lang})")


@app.get("/health")
async def health():
    """Health check endpoint"""
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    return {
        "status": "ok",
        "lang": pipeline.lang_code if hasattr(pipeline, 'lang_code') else "unknown",
        "voices_dir": str(voices_dir) if voices_dir else None
    }


@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    """Synthesize speech from text"""
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    try:
        # Determine which voice to use
        voice_to_use = request.custom_voicepack if (request.custom_voicepack and Path(request.custom_voicepack).exists()) else request.voice

        # Generate audio - pipeline returns a generator of Result objects
        gen = pipeline(
            request.text,
            voice=voice_to_use,
            speed=request.speed,
            split_pattern=r'\n+'
        )

        # Collect audio from all results
        audio_chunks = []
        for result in gen:
            # Audio is in result.output.audio (torch.Tensor)
            audio_tensor = result.output.audio
            # Convert to numpy array
            audio_np = audio_tensor.cpu().numpy()
            audio_chunks.append(audio_np)

        # Concatenate all chunks
        import numpy as np
        audio = np.concatenate(audio_chunks) if len(audio_chunks) > 1 else audio_chunks[0]

        # Kokoro uses 24kHz sample rate
        sr = 24000

        # Convert to WAV bytes
        buffer = io.BytesIO()
        sf.write(buffer, audio, sr, format='WAV')
        buffer.seek(0)

        return Response(
            content=buffer.read(),
            media_type="audio/wav"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")


@app.get("/voices")
async def list_voices():
    """List available voices"""
    # Parse VOICES.md if available
    voices_file = Path(__file__).parent / "VOICES.md"
    if voices_file.exists():
        # TODO: Parse VOICES.md and return structured data
        return {"voices": ["af_heart", "af_bella", "af_sarah"]}

    return {"voices": []}


if __name__ == "__main__":
    import uvicorn
    import sys

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9882)
    parser.add_argument("--lang", default="a")
    parser.add_argument("--voices-dir", type=Path)
    args = parser.parse_args()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="info"
    )
