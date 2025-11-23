#!/usr/bin/env python3
"""
Whisper STT FastAPI Server for MetaHuman OS
Provides HTTP endpoints for speech-to-text transcription using faster-whisper
"""
import argparse
import io
import json
import tempfile
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel

try:
    from faster_whisper import WhisperModel
except ImportError:
    print("Error: faster-whisper package not found")
    print("Install with: pip install faster-whisper")
    exit(1)

app = FastAPI(title="Whisper STT Server")

# Global model instance
model: Optional[WhisperModel] = None
model_config = {}
model_loading = False
model_ready = False


class TranscribeResponse(BaseModel):
    text: str
    language: str
    language_probability: float
    duration: Optional[float] = None


@app.on_event("startup")
async def startup():
    """Initialize Whisper model on server startup (non-blocking)"""
    global model, model_config, model_loading, model_ready
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base.en", help="Whisper model size")
    parser.add_argument("--device", default="cpu", help="Device to use: cpu or cuda")
    parser.add_argument("--compute-type", default="int8", help="Compute type: int8, float16, float32")
    parser.add_argument("--port", type=int, default=9883)
    args, _ = parser.parse_known_args()

    model_config = {
        'model': args.model,
        'device': args.device,
        'compute_type': args.compute_type
    }

    device = args.device if args.device in ['cpu', 'cuda'] else 'cpu'
    compute_type = args.compute_type if args.compute_type in ['int8', 'float16', 'float32'] else 'int8'

    # Adjust compute type based on device
    if device == 'cuda' and compute_type == 'int8':
        compute_type = 'float16'  # float16 is better for GPU

    # Load model in background thread to avoid blocking server startup
    def load_model():
        global model, model_loading, model_ready
        model_loading = True
        print(f"⏳ Loading Whisper model '{args.model}' on {device} with {compute_type}...")
        try:
            model = WhisperModel(args.model, device=device, compute_type=compute_type)
            model_ready = True
            print(f"✓ Whisper model initialized (model={args.model}, device={device}, compute_type={compute_type})")
        except Exception as e:
            print(f"✗ Failed to load Whisper model: {e}")
            model_ready = False
        finally:
            model_loading = False

    thread = threading.Thread(target=load_model, daemon=True)
    thread.start()
    print(f"🚀 Whisper server started, model loading in background...")


@app.get("/health")
async def health():
    """Health check endpoint - returns loading state"""
    global model, model_loading, model_ready

    if model_ready and model is not None:
        return {
            "status": "ready",
            "model": model_config.get('model', 'unknown'),
            "device": model_config.get('device', 'unknown'),
            "compute_type": model_config.get('compute_type', 'unknown')
        }
    elif model_loading:
        return {
            "status": "loading",
            "message": "Model is loading in background, please wait...",
            "model": model_config.get('model', 'unknown'),
            "device": model_config.get('device', 'unknown'),
            "compute_type": model_config.get('compute_type', 'unknown')
        }
    else:
        return {
            "status": "error",
            "message": "Model failed to load",
            "model": model_config.get('model', 'unknown')
        }


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = "en"):
    """Transcribe audio file to text"""
    global model, model_loading, model_ready

    if not model_ready or model is None:
        if model_loading:
            raise HTTPException(status_code=503, detail="Model is still loading, please wait...")
        else:
            raise HTTPException(status_code=503, detail="Model not initialized")

    try:
        # Read audio data
        audio_data = await file.read()

        # Detect file type and convert WebM to WAV if needed
        file_ext = Path(file.filename).suffix.lower()

        # Save to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        # Convert WebM to WAV using ffmpeg if needed
        final_path = tmp_path
        if file_ext in ['.webm', '.ogg', '.m4a']:
            wav_path = tmp_path.replace(file_ext, '.wav')
            try:
                import subprocess
                # Convert to WAV using ffmpeg (silent, overwrite)
                subprocess.run(
                    ['ffmpeg', '-i', tmp_path, '-ar', '16000', '-ac', '1', '-y', wav_path],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True
                )
                final_path = wav_path
            except (subprocess.CalledProcessError, FileNotFoundError) as e:
                # If ffmpeg fails or isn't installed, try original file anyway
                print(f"Warning: ffmpeg conversion failed ({e}), trying original file")
                final_path = tmp_path

        try:
            # Transcribe
            segments, info = model.transcribe(
                final_path,
                language=language,
                beam_size=5,
                vad_filter=True,  # Voice activity detection
                vad_parameters=dict(
                    min_silence_duration_ms=500
                )
            )

            # Collect all segments
            text_segments = []
            for segment in segments:
                text_segments.append(segment.text.strip())

            full_text = ' '.join(text_segments)

            return JSONResponse(content={
                "text": full_text,
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration
            })

        finally:
            # Clean up temp files
            Path(tmp_path).unlink(missing_ok=True)
            if final_path != tmp_path:
                Path(final_path).unlink(missing_ok=True)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/config")
async def get_config():
    """Get current model configuration"""
    return model_config


if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9883)
    args, _ = parser.parse_known_args()

    uvicorn.run(app, host="127.0.0.1", port=args.port)
