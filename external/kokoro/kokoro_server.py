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
    Stream speech synthesis chunk by chunk with parallel prefetching.
    Returns Server-Sent Events (SSE) with base64-encoded WAV chunks.

    Features:
    - Sub-sentence streaming: Yields phoneme chunks as they're generated
    - Parallel prefetching: Starts generating next sentence while current streams
    - Minimal latency: First audio chunk sent as soon as possible

    Each event contains:
    - data: JSON with {chunk_index, sentence_index, total_sentences, audio_base64, is_final}
    """
    from fastapi.responses import StreamingResponse
    import base64
    import numpy as np
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    from queue import Queue
    import threading

    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    # Thread pool for parallel synthesis
    executor = ThreadPoolExecutor(max_workers=2)

    def synthesize_sentence(sentence: str, voice: str, speed: float, normalize: bool) -> list:
        """Synthesize a single sentence in a thread, returning list of audio chunks"""
        chunks = []
        sr = 24000

        gen = pipeline(
            sentence,
            voice=voice,
            speed=speed,
            split_pattern=r'[.!?,;:\n]+'  # Split on more punctuation for finer chunks
        )

        for result in gen:
            audio_tensor = result.output.audio
            audio_np = audio_tensor.cpu().numpy()

            # Normalize chunk if requested
            if normalize:
                max_val = np.abs(audio_np).max()
                if max_val > 0:
                    target_peak = 0.707
                    gain = target_peak / max_val
                    audio_np = audio_np * gain

            # Convert to WAV bytes
            buffer = io.BytesIO()
            sf.write(buffer, audio_np, sr, format='WAV')
            buffer.seek(0)
            chunks.append(buffer.read())

        return chunks

    async def generate_chunks():
        try:
            voice_to_use = request.custom_voicepack if (request.custom_voicepack and Path(request.custom_voicepack).exists()) else request.voice

            print(f"[Kokoro Server] Streaming synthesis started (parallel mode):")
            print(f"  text length: {len(request.text)}")
            print(f"  voice: {voice_to_use}")

            # Split text into sentences for chunking
            import re
            # Split on sentence boundaries but keep the punctuation
            sentences = re.split(r'(?<=[.!?])\s+', request.text)
            sentences = [s.strip() for s in sentences if s.strip()]

            print(f"[Kokoro Server] Split into {len(sentences)} sentences")

            if not sentences:
                yield f"data: {json.dumps({'event': 'complete', 'total_chunks': 0})}\n\n"
                return

            chunk_index = 0
            loop = asyncio.get_event_loop()

            # Prefetch queue: maps sentence_index -> Future
            PREFETCH_COUNT = 2  # Prefetch 2 sentences ahead
            pending_futures = {}

            def start_prefetch(idx: int):
                """Start synthesizing a sentence if not already started"""
                if idx >= len(sentences) or idx in pending_futures:
                    return
                sentence = sentences[idx]
                future = loop.run_in_executor(
                    executor,
                    synthesize_sentence,
                    sentence,
                    voice_to_use,
                    request.speed,
                    request.normalize
                )
                pending_futures[idx] = future
                print(f"[Kokoro Server] Prefetching sentence {idx+1}/{len(sentences)}")

            # Start initial prefetch batch
            for i in range(min(PREFETCH_COUNT + 1, len(sentences))):
                start_prefetch(i)

            # Process sentences in order, streaming chunks as they complete
            for sentence_idx in range(len(sentences)):
                # Ensure this sentence is being generated
                start_prefetch(sentence_idx)

                # Start prefetching next sentences
                for j in range(sentence_idx + 1, min(sentence_idx + PREFETCH_COUNT + 1, len(sentences))):
                    start_prefetch(j)

                # Wait for current sentence's audio chunks
                future = pending_futures.get(sentence_idx)
                if not future:
                    continue

                try:
                    audio_chunks = await future
                    del pending_futures[sentence_idx]  # Free memory
                except Exception as e:
                    print(f"[Kokoro Server] Error synthesizing sentence {sentence_idx}: {e}")
                    continue

                if not audio_chunks:
                    continue

                # Stream each sub-chunk (phoneme group) immediately
                for sub_idx, wav_bytes in enumerate(audio_chunks):
                    audio_base64 = base64.b64encode(wav_bytes).decode('utf-8')

                    is_final = (sentence_idx == len(sentences) - 1) and (sub_idx == len(audio_chunks) - 1)
                    event_data = json.dumps({
                        "chunk_index": chunk_index,
                        "sentence_index": sentence_idx,
                        "sub_chunk_index": sub_idx,
                        "total_sentences": len(sentences),
                        "audio_base64": audio_base64,
                        "audio_size": len(wav_bytes),
                        "is_final": is_final
                    })

                    yield f"data: {event_data}\n\n"
                    chunk_index += 1

                    print(f"[Kokoro Server] Sent chunk {chunk_index} (sentence {sentence_idx+1}, sub {sub_idx+1}): {len(wav_bytes)} bytes")

            # Send completion event
            yield f"data: {json.dumps({'event': 'complete', 'total_chunks': chunk_index})}\n\n"
            print(f"[Kokoro Server] Streaming complete: {chunk_index} chunks sent")

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
