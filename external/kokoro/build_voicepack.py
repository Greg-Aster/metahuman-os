#!/usr/bin/env python3
"""
Kokoro Voicepack Trainer for MetaHuman OS
Optimizes Kokoro style tensors using recorded samples + transcripts.
"""

import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import soundfile as sf
import torch

# Torch / Kokoro imports are placed after torch init for clarity
try:
    from kokoro import KModel, KPipeline
except Exception as exc:  # pragma: no cover
    print("Failed to import kokoro modules. Did you install the Kokoro add-on?")
    print(str(exc))
    sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a Kokoro custom voicepack (.pt)")
    parser.add_argument("--speaker", required=True, help="Speaker identifier (used for status/log files)")
    parser.add_argument("--dataset", required=True, help="Directory containing copied training samples (.wav + .txt)")
    parser.add_argument("--output", required=True, help="Output .pt path for trained voicepack")
    parser.add_argument("--lang", default="a", help="Language code (default: a / American English)")
    parser.add_argument("--base-voice", default="af_heart", help="Built-in Kokoro voice to initialize from")
    parser.add_argument("--epochs", type=int, default=120, help="Number of fine-tuning epochs (default: 120)")
    parser.add_argument("--learning-rate", type=float, default=5e-4, help="Adam learning rate (default: 5e-4)")
    parser.add_argument("--regularization", type=float, default=5e-3, help="Weight for staying close to base voicepack")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto", help="Device for training")
    parser.add_argument("--max-samples", type=int, default=200, help="Maximum samples to use (random subset)")
    parser.add_argument("--status-file", help="Path to JSON status file for UI updates")
    parser.add_argument("--log-file", help="Optional log file path")
    parser.add_argument("--seed", type=int, default=2024, help="Random seed")
    parser.add_argument("--max-clip-seconds", type=float, default=12.0, help="Clamp audio longer than this (seconds)")
    parser.add_argument("--speed", type=float, default=1.0, help="Kokoro speaking speed during optimization")
    return parser.parse_args()


def setup_logging(log_file: Optional[str]):
    if not log_file:
        return None
    log_path = Path(log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(log_path, "a", encoding="utf-8")
    return fh


class StatusWriter:
    def __init__(self, status_path: Optional[str], speaker: str):
        self.status_path = Path(status_path) if status_path else None
        self.speaker = speaker

    def write(self, **data):
        if not self.status_path:
            return
        payload = {
            "speakerId": self.speaker,
            "timestamp": int(time.time() * 1000),
            **data,
        }
        self.status_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.status_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)


def log(msg: str, handle):
    line = f"[kokoro-train] {msg}"
    print(line)
    if handle:
        handle.write(line + "\n")
        handle.flush()


def normalize_audio(audio: np.ndarray) -> np.ndarray:
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    max_val = np.max(np.abs(audio)) or 1.0
    return (audio / max_val).astype(np.float32)


def resample(audio: np.ndarray, source_rate: int, target_rate: int = 24000) -> np.ndarray:
    if source_rate == target_rate:
        return audio.astype(np.float32)
    duration = audio.shape[0] / float(source_rate)
    target_len = int(duration * target_rate)
    if target_len < 1:
        target_len = 1
    x_old = np.linspace(0.0, 1.0, num=audio.shape[0], endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=target_len, endpoint=False)
    resampled = np.interp(x_new, x_old, audio).astype(np.float32)
    return resampled


def load_wave_raw(path: Path) -> Tuple[np.ndarray, int]:
    """Load raw audio without normalization for quality checks"""
    data, sr = sf.read(path)
    data = np.asarray(data)
    if data.ndim > 1:
        data = data.mean(axis=1)  # Convert to mono
    if sr <= 0:
        sr = 24000
    return data, sr


def load_wave(path: Path, max_seconds: float) -> Tuple[torch.Tensor, float]:
    data, sr = load_wave_raw(path)
    data = normalize_audio(data)
    data = resample(data, sr, 24000)
    max_len = int(max_seconds * 24000)
    if data.shape[0] > max_len:
        data = data[:max_len]
    return torch.from_numpy(data), data.shape[0] / 24000.0


def text_to_phonemes(pipeline: KPipeline, text: str) -> Optional[str]:
    text = text.strip()
    if not text:
        return None
    segments: List[str] = []
    try:
        if pipeline.lang_code in "ab":
            _, tokens = pipeline.g2p(text)
            for _, ps, _ in pipeline.en_tokenize(tokens):
                if ps:
                    segments.append(ps.strip())
        else:
            for result in pipeline(text, voice=None, model=False):
                if result.phonemes:
                    segments.append(result.phonemes.strip())
    except Exception:
        return None
    if not segments:
        return None
    phonemes = " ".join(segments).strip()
    return phonemes if phonemes else None


def phonemes_to_ids(phonemes: str, vocab: Dict[str, int], context_len: int) -> Optional[torch.LongTensor]:
    input_ids = [0]
    for char in phonemes:
        idx = vocab.get(char)
        if idx is not None:
            input_ids.append(idx)
    input_ids.append(0)
    if len(input_ids) > context_len:
        return None
    return torch.LongTensor([input_ids])


def collect_dataset(
    dataset_dir: Path,
    pipeline: KPipeline,
    kmodel: KModel,
    max_samples: int,
    max_clip_seconds: float,
    log_handle,
) -> List[Dict]:
    entries: List[Dict] = []
    rejected_count = {"low_volume": 0, "clipping": 0, "noise": 0, "too_short": 0}
    wav_files = sorted(dataset_dir.glob("*.wav"))
    random.shuffle(wav_files)
    for wav_path in wav_files:
        txt_path = wav_path.with_suffix(".txt")
        if not txt_path.exists():
            continue
        try:
            transcript = txt_path.read_text(encoding="utf-8").strip()
        except Exception:
            continue
        if len(transcript) < 10:
            rejected_count["too_short"] += 1
            continue
        phonemes = text_to_phonemes(pipeline, transcript)
        if not phonemes:
            continue
        input_ids = phonemes_to_ids(phonemes, kmodel.vocab, kmodel.context_length)
        if input_ids is None:
            continue

        # Load raw audio for quality checks (before normalization)
        try:
            raw_audio, sample_rate = load_wave_raw(wav_path)
        except Exception:
            continue

        # Quality filtering on RAW audio (before normalization)
        # 1. Check for clipping (> 95% of max range)
        # Note: Raw audio max is typically 1.0 for float32 or 32768 for int16
        max_val = np.max(np.abs(raw_audio))
        if max_val > 0.95 * np.iinfo(np.int16).max if raw_audio.dtype == np.int16 else max_val > 0.95:
            rejected_count["clipping"] += 1
            continue

        # 2. Check volume (RMS should be > -40 dB relative to full scale)
        rms = np.sqrt(np.mean(raw_audio**2))
        # Normalize RMS to full scale range
        if raw_audio.dtype == np.int16:
            rms = rms / np.iinfo(np.int16).max
        rms_db = 20 * np.log10(rms + 1e-10)
        if rms_db < -40:
            rejected_count["low_volume"] += 1
            continue

        # 3. Estimate SNR (simple noise floor check)
        # Split into frames, find quietest 10% as noise floor
        frame_size = int(0.1 * sample_rate)  # 0.1 seconds
        frames = [raw_audio[i:i+frame_size] for i in range(0, len(raw_audio), frame_size)]
        frame_rms = [np.sqrt(np.mean(f**2)) for f in frames if len(f) == frame_size]
        if len(frame_rms) > 10:
            noise_floor = np.percentile(frame_rms, 10)
            signal_level = np.percentile(frame_rms, 90)
            snr = signal_level / (noise_floor + 1e-10)
            if snr < 3.0:  # SNR < 10 dB
                rejected_count["noise"] += 1
                continue

        # Audio passed quality checks - now normalize and process it
        try:
            audio_tensor, duration = load_wave(wav_path, max_clip_seconds)
        except Exception:
            continue

        entries.append(
            {
                "input_ids": input_ids,
                "phoneme_len": max(1, len(phonemes)),
                "audio": audio_tensor,
                "duration": duration,
                "text": transcript,
                "path": str(wav_path),
            }
        )
        if len(entries) >= max_samples:
            break

    log(f"Sample quality filtering results:", log_handle)
    log(f"  Accepted: {len(entries)} samples", log_handle)
    log(f"  Rejected - Low volume: {rejected_count['low_volume']}", log_handle)
    log(f"  Rejected - Clipping: {rejected_count['clipping']}", log_handle)
    log(f"  Rejected - Noisy: {rejected_count['noise']}", log_handle)
    log(f"  Rejected - Too short: {rejected_count['too_short']}", log_handle)

    random.shuffle(entries)
    return entries


def choose_device(requested: str) -> torch.device:
    if requested == "cpu":
        return torch.device("cpu")
    if requested == "cuda":
        if torch.cuda.is_available():
            return torch.device("cuda")
        raise RuntimeError("CUDA requested but not available")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def train_voicepack(args: argparse.Namespace):
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    log_handle = setup_logging(args.log_file)
    status = StatusWriter(args.status_file, args.speaker)

    dataset_dir = Path(args.dataset)
    if not dataset_dir.exists():
        raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    status.write(status="initializing", progress=0, message="Loading Kokoro model...")
    log("Loading Kokoro model + pipeline...", log_handle)

    device = choose_device(args.device)
    pipeline = KPipeline(lang_code=args.lang, model=False)
    kmodel = KModel().to(device)
    # Enable gradients for forward pass
    kmodel.forward_with_tokens = kmodel.forward_with_tokens.__wrapped__.__get__(kmodel, KModel)  # type: ignore

    # GPU Memory Optimization 1: Freeze base model parameters (only train voicepack)
    # This saves ~13GB of gradient memory
    if device.type == 'cuda':
        log("Freezing base model parameters (GPU memory optimization)", log_handle)
        for param in kmodel.parameters():
            param.requires_grad = False
        # Note: Keep model in training mode for RNN backward pass (cuDNN requirement)
        # The frozen parameters won't update even in training mode

        # Clear GPU cache to maximize available memory
        torch.cuda.empty_cache()
        log(f"GPU memory after optimization: {torch.cuda.memory_allocated(device) / 1024**3:.2f} GB allocated", log_handle)

    base_voice_pack = pipeline.load_voice(args.base_voice)
    style_slots, _, style_dim = base_voice_pack.shape
    voicepack = torch.nn.Parameter(base_voice_pack.squeeze(1).to(device).clone())
    base_reference = base_voice_pack.squeeze(1).to(device)

    entries = collect_dataset(
        dataset_dir=dataset_dir,
        pipeline=pipeline,
        kmodel=kmodel,
        max_samples=args.max_samples,
        max_clip_seconds=args.max_clip_seconds,
        log_handle=log_handle,
    )

    total_duration = sum(item["duration"] for item in entries)
    if len(entries) < 10 or total_duration < 120:
        raise RuntimeError(
            f"Insufficient dataset: need at least 10 samples / 120 seconds. Found {len(entries)} samples, {total_duration:.1f}s."
        )

    log(
        f"Dataset ready: {len(entries)} samples, {total_duration/60:.2f} minutes (lang={args.lang}, base={args.base_voice})",
        log_handle,
    )

    optimizer = torch.optim.Adam([voicepack], lr=args.learning_rate)
    l1 = torch.nn.L1Loss()
    device_name = str(device)

    # GPU Memory Optimization 2: Mixed Precision Training (FP16)
    # Reduces memory usage by ~40-50%
    use_amp = device.type == 'cuda'
    scaler = torch.cuda.amp.GradScaler() if use_amp else None
    if use_amp:
        log("Enabling mixed precision training (FP16) for GPU memory optimization", log_handle)

    status.write(
        status="running",
        progress=0,
        message="Training voicepack...",
        datasetSamples=len(entries),
        datasetMinutes=total_duration / 60.0,
        device=device_name,
    )

    step_count = len(entries)
    total_steps = max(1, args.epochs * step_count)
    global_step = 0

    try:
        for epoch in range(1, args.epochs + 1):
            random.shuffle(entries)
            epoch_loss = 0.0
            for entry in entries:
                optimizer.zero_grad()
                ids = entry["input_ids"].to(device)
                target = entry["audio"].to(device)
                style_index = min(entry["phoneme_len"] - 1, style_slots - 1)
                ref = voicepack[style_index].unsqueeze(0)

                # Forward pass
                if use_amp:
                    with torch.cuda.amp.autocast():
                        waveform, _ = kmodel.forward_with_tokens(ids, ref, args.speed)
                else:
                    waveform, _ = kmodel.forward_with_tokens(ids, ref, args.speed)

                pred = waveform.squeeze()
                min_len = min(pred.shape[-1], target.shape[-1])
                if min_len <= 0:
                    continue

                pred = pred[:min_len]
                tgt = target[:min_len]

                # Loss calculation (keep in FP32 for stability)
                loss = l1(pred, tgt)
                reg = torch.nn.functional.mse_loss(ref, base_reference[style_index].unsqueeze(0))
                total = loss + args.regularization * reg

                # Backward pass
                if use_amp:
                    scaler.scale(total).backward()
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    total.backward()
                    optimizer.step()

                with torch.no_grad():
                    voicepack.data.clamp_(-3.0, 3.0)
                epoch_loss += total.item()

                global_step += 1
                if global_step % 10 == 0:
                    progress = round(100 * (global_step / total_steps), 2)
                    status.write(
                        status="running",
                        progress=min(progress, 100),
                        currentEpoch=epoch,
                        totalEpochs=args.epochs,
                        message="Training voicepack...",
                        loss=round(total.item(), 5),
                    )

            avg_loss = epoch_loss / max(1, len(entries))
            log(f"Epoch {epoch}/{args.epochs} - avg loss {avg_loss:.5f}", log_handle)
            status.write(
                status="running",
                progress=min(100, round(100 * (epoch / args.epochs), 2)),
                currentEpoch=epoch,
                totalEpochs=args.epochs,
                message=f"Epoch {epoch} complete",
                loss=round(avg_loss, 6),
            )

    except KeyboardInterrupt:
        status.write(status="failed", progress=0, error="Training interrupted by user")
        raise
    except Exception as exc:
        status.write(status="failed", progress=0, error=str(exc))
        raise

    final_pack = voicepack.detach().cpu().unsqueeze(1)
    torch.save(final_pack, output_path)
    status.write(
        status="completed",
        progress=100,
        message="Voicepack training complete",
        voicepackPath=str(output_path),
        datasetSamples=len(entries),
        datasetMinutes=total_duration / 60.0,
    )
    log(f"Voicepack saved to {output_path}", log_handle)
    if log_handle:
        log_handle.close()


def main():
    args = parse_args()
    try:
        train_voicepack(args)
    except Exception as exc:
        print(f"[kokoro-train] Failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
