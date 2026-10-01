"""Batch inference adapter; MetaHuman owns phrase splitting and streaming."""
import argparse
from contextlib import asynccontextmanager
from io import BytesIO
import logging
from threading import Lock

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field
import soundfile as sf
import uvicorn

from kitten_runtime import SAMPLE_RATE, VOICES, load_model, synthesize

logger = logging.getLogger(__name__)
model = None
model_lock = Lock()


@asynccontextmanager
async def lifespan(app):
    global model
    model = load_model()
    yield
    model = None


app = FastAPI(lifespan=lifespan)


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    voice: str = "Jasper"
    speed: float = Field(default=1.0, ge=0.5, le=2.0, allow_inf_nan=False)


@app.get("/health")
async def health():
    return {
        "status": "ready" if model is not None else "loading",
        "engine": "kitten", "model": "micro-0.8", "device": "cpu",
        "execution_provider": "CPUExecutionProvider", "voices": list(VOICES),
        "sample_rate": SAMPLE_RATE,
    }


@app.post("/synthesize")
def generate(request: SynthesisRequest):
    if model is None:
        raise HTTPException(503, "Kitten is loading")
    if request.voice not in VOICES:
        raise HTTPException(400, f"Unknown Kitten voice: {request.voice}")
    if not request.text.strip():
        raise HTTPException(400, "Text is required")
    try:
        # ONNX, phonemizer and the shared NPZ voice archive have one caller at a
        # time. FastAPI workers keep health responsive during CPU synthesis.
        with model_lock:
            audio = synthesize(model, request.text, request.voice, request.speed)
        output = BytesIO()
        sf.write(output, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        return Response(output.getvalue(), media_type="audio/wav")
    except Exception as error:
        logger.exception("Kitten synthesis failed")
        raise HTTPException(500, "Kitten synthesis failed") from error


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9884)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port)
