from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class SynthesisDefaults:
    lang_code: str = "a"
    voice: str = "af_heart"
    speed: float = 1.0
    custom_voicepack: str | None = None
    normalize: bool = False


def load_synthesis_defaults(
    config_paths: list[Path] | None = None,
    config_json: str | None = None,
) -> SynthesisDefaults:
    """Load one merged Kokoro preset for text-only synthesis requests."""
    defaults = SynthesisDefaults()
    raw_json = config_json if config_json is not None else os.environ.get(
        "KOKORO_DEFAULT_CONFIG_JSON"
    )
    if raw_json:
        defaults = _merge(defaults, _decode_mapping(raw_json), None)

    paths = config_paths
    if paths is None:
        encoded_paths = os.environ.get("KOKORO_VOICE_CONFIGS", "")
        paths = [Path(value) for value in encoded_paths.split(os.pathsep) if value]

    for config_path in paths:
        if not config_path.is_file():
            raise ValueError(f"Kokoro voice config does not exist: {config_path}")
        payload = _decode_mapping(config_path.read_text(encoding="utf-8"))
        defaults = _merge(defaults, payload, config_path)
    return defaults


def _decode_mapping(raw: str) -> Mapping[str, object]:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Kokoro voice configuration must be a JSON object")
    return value


def _kokoro_section(payload: Mapping[str, object]) -> Mapping[str, object]:
    tts = payload.get("tts")
    if isinstance(tts, dict):
        kokoro = tts.get("kokoro")
        if isinstance(kokoro, dict):
            return kokoro
    kokoro = payload.get("kokoro")
    if isinstance(kokoro, dict):
        return kokoro
    return payload


def _merge(
    current: SynthesisDefaults,
    payload: Mapping[str, object],
    config_path: Path | None,
) -> SynthesisDefaults:
    section = _kokoro_section(payload)
    lang_code = _optional_string(section, "langCode", "lang_code") or current.lang_code
    voice = _optional_string(section, "voice") or current.voice

    speed_value = section.get("speed", current.speed)
    if isinstance(speed_value, bool) or not isinstance(speed_value, (int, float)):
        raise ValueError("Kokoro speed must be a number")
    speed = float(speed_value)
    if not 0.5 <= speed <= 2.0:
        raise ValueError("Kokoro speed must be between 0.5 and 2.0")

    custom_voicepack = current.custom_voicepack
    use_custom = section.get("useCustomVoicepack")
    configured_custom = _optional_string(
        section,
        "customVoicepackPath",
        "custom_voicepack",
    )
    if use_custom is False:
        custom_voicepack = None
    elif configured_custom:
        custom_voicepack = _resolve_config_path(configured_custom, config_path)

    normalize_value = section.get(
        "normalizeCustomVoicepacks",
        section.get("normalize", current.normalize),
    )
    if not isinstance(normalize_value, bool):
        raise ValueError("Kokoro normalization setting must be boolean")

    return SynthesisDefaults(
        lang_code=lang_code,
        voice=voice,
        speed=speed,
        custom_voicepack=custom_voicepack,
        normalize=normalize_value if custom_voicepack else False,
    )


def _optional_string(
    payload: Mapping[str, object],
    *keys: str,
) -> str | None:
    for key in keys:
        value = payload.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Kokoro {key} must be a non-empty string")
        return value.strip()
    return None


def _resolve_config_path(value: str, config_path: Path | None) -> str:
    metahuman_root = Path(__file__).resolve().parents[2]
    resolved = value.replace("{METAHUMAN_ROOT}", str(metahuman_root))
    if "{PROFILE_DIR}" in resolved:
        if config_path is None or config_path.parent.name != "etc":
            raise ValueError("Kokoro custom voice pack needs a profile voice config")
        profile_dir = config_path.parent.parent
        resolved = resolved.replace("{PROFILE_DIR}", str(profile_dir))
    path = Path(resolved).expanduser()
    if not path.is_absolute() and config_path is not None:
        path = config_path.parent / path
    return str(path.resolve())
