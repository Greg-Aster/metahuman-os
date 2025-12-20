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
    normalize: bool = False


@app.on_event("startup")
async def startup():
    """Initialize Kokoro pipeline on server startup"""
    global pipeline, voices_dir
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", default="a", help="Default language code")
    parser.add_argument("--voices-dir", type=Path, help="Custom voices directory")
    parser.add_argument("--port", type=int, default=9882)
    parser.add_argument("--device", default="cpu", help="Device to use: cpu or cuda")
    args, _ = parser.parse_known_args()

    voices_dir = args.voices_dir
    device = args.device if args.device in ['cpu', 'cuda'] else 'cpu'
    pipeline = KPipeline(lang_code=args.lang, device=device)
    print(f"✓ Kokoro pipeline initialized (lang_code={args.lang}, device={device})")


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

        # Debug logging
        print(f"[Kokoro Server] Synthesize request:")
        print(f"  text: {request.text[:50]}...")
        print(f"  voice: {request.voice}")
        print(f"  custom_voicepack: {request.custom_voicepack}")
        print(f"  voice_to_use: {voice_to_use}")
        print(f"  lang_code: {request.lang_code}")
        print(f"  speed: {request.speed}")
        print(f"  normalize: {request.normalize}")

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

        # Normalize audio if requested (typically for custom voicepacks)
        # Target peak of -3 dB (0.707 of max range)
        if request.normalize:
            max_val = np.abs(audio).max()
            if max_val > 0:
                target_peak = 0.707  # -3 dB
                gain = target_peak / max_val
                audio = audio * gain
                print(f"[Kokoro Server] Applied normalization: gain={gain:.3f}x")

        # Kokoro uses 24kHz sample rate
        sr = 24000

        # Convert to WAV bytes
        buffer = io.BytesIO()
        sf.write(buffer, audio, sr, format='WAV')
        buffer.seek(0)

        print(f"[Kokoro Server] Successfully generated {len(audio)} samples")

        return Response(
            content=buffer.read(),
            media_type="audio/wav"
        )

    except Exception as e:
        import traceback
        print(f"[Kokoro Server] ERROR: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")


class StreamSynthesizeRequest(BaseModel):
    """Request schema for streaming synthesis"""
    text: str
    lang_code: str = "a"
    voice: str = "af_heart"
    speed: float = 1.0
    custom_voicepack: Optional[str] = None
    normalize: bool = False


@app.post("/synthesize-stream")
async def synthesize_stream(request: StreamSynthesizeRequest):
    """
    PARAGRAPH-LEVEL speech synthesis streaming.
    Returns Server-Sent Events (SSE) with base64-encoded WAV chunks.

    Features:
    - Respects actual paragraph boundaries (double newlines in text)
    - Each paragraph synthesized as one continuous audio chunk
    - Natural pauses occur ONLY at real paragraph breaks
    - Prefetches next paragraph while current one plays

    Each event contains:
    - data: JSON with {chunk_index, audio_base64, audio_size, is_final}
    - Final 'complete' event with total_chunks count
    """
    from fastapi.responses import StreamingResponse
    from concurrent.futures import ThreadPoolExecutor
    import base64
    import numpy as np
    import asyncio
    import re

    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    # Thread pool for parallel paragraph synthesis
    executor = ThreadPoolExecutor(max_workers=3)

    def synthesize_paragraph(paragraph: str, voice: str, speed: float, normalize: bool) -> bytes:
        """Synthesize a full paragraph as ONE continuous audio chunk.

        Key: We use split_pattern=None to prevent ANY internal splitting.
        The entire paragraph becomes one seamless audio segment.
        """
        sr = 24000

        # NO split pattern = entire paragraph as one chunk
        # This ensures continuous audio within each paragraph
        gen = pipeline(
            paragraph,
            voice=voice,
            speed=speed,
            split_pattern=None  # CRITICAL: No splitting = continuous audio
        )

        # Collect all audio (should be just one chunk with split_pattern=None)
        audio_chunks = []
        for result in gen:
            audio_tensor = result.output.audio
            audio_np = audio_tensor.cpu().numpy()
            audio_chunks.append(audio_np)

        # Concatenate if multiple (shouldn't happen with split_pattern=None)
        if len(audio_chunks) > 1:
            audio = np.concatenate(audio_chunks)
        elif audio_chunks:
            audio = audio_chunks[0]
        else:
            return b''

        # Normalize if requested
        if normalize:
            max_val = np.abs(audio).max()
            if max_val > 0:
                target_peak = 0.707
                gain = target_peak / max_val
                audio = audio * gain

        # Convert to WAV bytes
        buffer = io.BytesIO()
        sf.write(buffer, audio, sr, format='WAV')
        buffer.seek(0)
        return buffer.read()

    async def generate_chunks():
        try:
            voice_to_use = request.custom_voicepack if (request.custom_voicepack and Path(request.custom_voicepack).exists()) else request.voice

            print(f"[Kokoro Server] PARAGRAPH-LEVEL streaming started:")
            print(f"  text length: {len(request.text)}")
            print(f"  voice: {voice_to_use}")

            # Split text into REAL paragraphs (double newlines) first
            raw_paragraphs = re.split(r'\n\s*\n', request.text)
            raw_paragraphs = [p.strip() for p in raw_paragraphs if p.strip()]

            # FALLBACK: If no paragraph breaks OR any paragraph is too long,
            # use character-based chunking (400-800 chars) for natural pacing
            MIN_CHUNK_LENGTH = 400
            MAX_CHUNK_LENGTH = 800

            paragraphs = []
            for para in raw_paragraphs:
                if len(para) <= MAX_CHUNK_LENGTH:
                    # Paragraph is good size, use as-is
                    paragraphs.append(para)
                else:
                    # Long paragraph - split at sentence boundaries
                    sentences = re.split(r'(?<=[.!?])\s+', para)
                    current_chunk = []
                    current_length = 0

                    for sentence in sentences:
                        sentence = sentence.strip()
                        if not sentence:
                            continue

                        # If adding this sentence would exceed max, finalize current chunk
                        if current_length + len(sentence) > MAX_CHUNK_LENGTH and current_chunk:
                            paragraphs.append(' '.join(current_chunk))
                            current_chunk = []
                            current_length = 0

                        current_chunk.append(sentence)
                        current_length += len(sentence) + 1  # +1 for space

                        # If chunk is good size (>= MIN), finalize it
                        if current_length >= MIN_CHUNK_LENGTH:
                            paragraphs.append(' '.join(current_chunk))
                            current_chunk = []
                            current_length = 0

                    # Don't forget remaining sentences
                    if current_chunk:
                        paragraphs.append(' '.join(current_chunk))

            # If still no paragraphs (empty text or no splits found), use full text
            if len(paragraphs) == 0 and request.text.strip():
                # No paragraph breaks - chunk the entire text by character count
                text = request.text.strip()
                sentences = re.split(r'(?<=[.!?])\s+', text)
                current_chunk = []
                current_length = 0

                for sentence in sentences:
                    sentence = sentence.strip()
                    if not sentence:
                        continue

                    if current_length + len(sentence) > MAX_CHUNK_LENGTH and current_chunk:
                        paragraphs.append(' '.join(current_chunk))
                        current_chunk = []
                        current_length = 0

                    current_chunk.append(sentence)
                    current_length += len(sentence) + 1

                    if current_length >= MIN_CHUNK_LENGTH:
                        paragraphs.append(' '.join(current_chunk))
                        current_chunk = []
                        current_length = 0

                if current_chunk:
                    paragraphs.append(' '.join(current_chunk))

            print(f"[Kokoro Server] Split into {len(paragraphs)} chunks (from {len(raw_paragraphs)} raw paragraphs)")
            for i, p in enumerate(paragraphs):
                print(f"  Chunk {i+1}: {len(p)} chars - '{p[:50]}...'")

            if not paragraphs:
                yield f"data: {json.dumps({'event': 'complete', 'total_chunks': 0})}\n\n"
                return

            loop = asyncio.get_event_loop()

            # Prefetch queue: paragraph_index -> Future
            PREFETCH_COUNT = 2  # Prefetch 2 paragraphs ahead
            pending_futures = {}

            def start_prefetch(idx: int):
                """Start synthesizing a paragraph if not already started"""
                if idx >= len(paragraphs) or idx in pending_futures:
                    return
                paragraph = paragraphs[idx]
                future = loop.run_in_executor(
                    executor,
                    synthesize_paragraph,
                    paragraph,
                    voice_to_use,
                    request.speed,
                    request.normalize
                )
                pending_futures[idx] = future
                print(f"[Kokoro Server] Prefetching paragraph {idx+1}/{len(paragraphs)} ({len(paragraph)} chars)")

            # Start initial prefetch batch
            for i in range(min(PREFETCH_COUNT + 1, len(paragraphs))):
                start_prefetch(i)

            # Process paragraphs in order, streaming as they complete
            for para_idx in range(len(paragraphs)):
                # Ensure this paragraph is being generated
                start_prefetch(para_idx)

                # Start prefetching next paragraphs
                for j in range(para_idx + 1, min(para_idx + PREFETCH_COUNT + 1, len(paragraphs))):
                    start_prefetch(j)

                # Wait for current paragraph's audio
                future = pending_futures.get(para_idx)
                if not future:
                    continue

                try:
                    wav_bytes = await future
                    del pending_futures[para_idx]  # Free memory
                except Exception as e:
                    print(f"[Kokoro Server] Error synthesizing paragraph {para_idx}: {e}")
                    continue

                if not wav_bytes:
                    continue

                audio_base64 = base64.b64encode(wav_bytes).decode('utf-8')

                is_final = para_idx == len(paragraphs) - 1
                event_data = json.dumps({
                    "chunk_index": para_idx,
                    "sentence_index": para_idx,
                    "sub_chunk_index": 0,
                    "total_sentences": len(paragraphs),
                    "audio_base64": audio_base64,
                    "audio_size": len(wav_bytes),
                    "is_final": is_final
                })

                yield f"data: {event_data}\n\n"
                print(f"[Kokoro Server] Streamed paragraph {para_idx+1}/{len(paragraphs)}: {len(wav_bytes)} bytes")

            # Send completion event
            yield f"data: {json.dumps({'event': 'complete', 'total_chunks': len(paragraphs)})}\n\n"
            print(f"[Kokoro Server] Streaming complete: {len(paragraphs)} paragraphs sent")

        except Exception as e:
            import traceback
            print(f"[Kokoro Server] Streaming ERROR: {e}")
            traceback.print_exc()
            yield f"data: {json.dumps({'event': 'error', 'error': str(e)})}\n\n"
        finally:
            executor.shutdown(wait=False)

    return StreamingResponse(
        generate_chunks(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


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
    parser.add_argument("--device", default="cpu", help="Device to use: cpu or cuda")
    args = parser.parse_args()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="info"
    )
