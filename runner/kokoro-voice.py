#!/usr/bin/env python3
"""Isolated offline TTS wrapper. Model and voice assets are installed by the operator."""
import argparse
from pathlib import Path

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--voices", required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--voice", required=True)
    p.add_argument("--language", default="en")
    args = p.parse_args()
    if args.language != "en":
        raise SystemExit("Kokoro English voice profile requires language=en")
    for item in [args.model, args.voices, args.text]:
        if not Path(item).is_file():
            raise SystemExit("Missing TTS asset: " + item)
    from kokoro_onnx import Kokoro
    import soundfile as sf
    voice = Kokoro(args.model, args.voices)
    try:
        audio, sample_rate = voice.create(Path(args.text).read_text(encoding="utf-8"),
                                          voice=args.voice, speed=1.0, lang="en-us")
        sf.write(args.output, audio, sample_rate, subtype="PCM_16")
    finally:
        voice.voices.close()

if __name__ == "__main__":
    main()
