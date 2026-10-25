#!/usr/bin/env python3
"""Render a German Piper ONNX voice without exposing arbitrary commands."""
import argparse
from pathlib import Path
import subprocess
import sys

def main():
    args = argparse.ArgumentParser()
    args.add_argument("--model", required=True)
    args.add_argument("--text", required=True)
    args.add_argument("--output", required=True)
    settings = args.parse_args()
    model = Path(settings.model)
    config = model.with_suffix(model.suffix + ".json")
    if model.name != "de_DE-thorsten-medium.onnx" or not model.is_file() or not config.is_file():
        raise SystemExit("German Piper voice model or configuration is missing.")
    text = Path(settings.text).read_text(encoding="utf-8")
    if not 5 <= len(text) <= 1400:
        raise SystemExit("Piper narration length is invalid.")
    command = [sys.executable, "-m", "piper", "--model", str(model),
               "--output_file", settings.output]
    subprocess.run(command, input=text + "\n", text=True, check=True, timeout=180)

if __name__ == "__main__":
    main()
