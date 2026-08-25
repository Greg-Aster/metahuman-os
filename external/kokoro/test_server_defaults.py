from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from server_defaults import SynthesisDefaults, load_synthesis_defaults


class SynthesisDefaultsTests(unittest.TestCase):
    def test_defaults_are_stable_without_configuration(self) -> None:
        self.assertEqual(load_synthesis_defaults([], None), SynthesisDefaults())

    def test_global_and_profile_configs_merge_into_one_server_preset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            global_config = root / "etc" / "voice.json"
            profile_config = root / "profiles" / "robot" / "etc" / "voice.json"
            global_config.parent.mkdir(parents=True)
            profile_config.parent.mkdir(parents=True)
            global_config.write_text(
                json.dumps(
                    {
                        "tts": {
                            "kokoro": {
                                "voice": "af_heart",
                                "langCode": "a",
                                "speed": 1.0,
                                "useCustomVoicepack": False,
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            profile_config.write_text(
                json.dumps(
                    {
                        "tts": {
                            "kokoro": {
                                "voice": "bf_lily",
                                "speed": 1.25,
                                "useCustomVoicepack": True,
                                "customVoicepackPath": "{PROFILE_DIR}/out/voices/robot.pt",
                                "normalizeCustomVoicepacks": True,
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            defaults = load_synthesis_defaults(
                [global_config, profile_config],
                None,
            )

            self.assertEqual(defaults.lang_code, "a")
            self.assertEqual(defaults.voice, "bf_lily")
            self.assertEqual(defaults.speed, 1.25)
            self.assertEqual(
                defaults.custom_voicepack,
                str((profile_config.parent.parent / "out/voices/robot.pt").resolve()),
            )
            self.assertTrue(defaults.normalize)

    def test_resolved_provider_config_can_be_supplied_as_json(self) -> None:
        defaults = load_synthesis_defaults(
            [],
            json.dumps(
                {
                    "lang_code": "b",
                    "voice": "am_adam",
                    "speed": 0.9,
                    "custom_voicepack": None,
                    "normalize": False,
                }
            ),
        )

        self.assertEqual(
            defaults,
            SynthesisDefaults(lang_code="b", voice="am_adam", speed=0.9),
        )

    def test_invalid_speed_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "between 0.5 and 2.0"):
            load_synthesis_defaults([], json.dumps({"speed": 4.0}))


if __name__ == "__main__":
    unittest.main()
