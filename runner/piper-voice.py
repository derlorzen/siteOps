#!/usr/bin/env python3
"""German offline speech generation using Piper and licensed German voice models."""
import argparse
import wave
from pathlib import Path

VOICES = {
    "de_DE-thorsten-medium": "de_DE-thorsten-medium.onnx",
    "de_DE-kerstin-low": "de_DE-kerstin-low.onnx",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--voice", choices=sorted(VOICES), required=True)
    args = parser.parse_args()
    model = Path(args.models_dir) / VOICES[args.voice]
    config = Path(str(model) + ".json")
    if not model.is_file() or not config.is_file():
        raise SystemExit("German Piper voice missing: " + args.voice + ". Install the ONNX model and JSON config.")
    phrase = Path(args.text).read_text(encoding="utf-8").strip()
    if not phrase:
        raise SystemExit("German narration is empty.")
    from piper import PiperVoice
    voice = PiperVoice.load(str(model), config_path=str(config))
    with wave.open(args.output, "wb") as wav:
        voice.synthesize_wav(phrase, wav)

if __name__ == "__main__":
    main()
