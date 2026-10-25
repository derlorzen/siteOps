#!/usr/bin/env python3
"""Install licensed voice *data* (never executable code) from their upstream release URLs.

On first container startup, download the required offline voices into a writable model
volume. If the network is unavailable, fail explicitly. Don't silently replace or
overwrite an existing valid installation.
"""
import argparse
import hashlib
import os
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen

KOKORO = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/"
PIPER = "https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/"
ASSETS = {
    "kokoro-v1.0.onnx": (KOKORO + "kokoro-v1.0.onnx", 250_000_000, 450_000_000),
    "voices-v1.0.bin": (KOKORO + "voices-v1.0.bin", 20_000_000, 50_000_000),
    "de_DE-thorsten-medium.onnx": (PIPER + "thorsten/medium/de_DE-thorsten-medium.onnx", 40_000_000, 90_000_000),
    "de_DE-thorsten-medium.onnx.json": (PIPER + "thorsten/medium/de_DE-thorsten-medium.onnx.json", 100, 100_000),
    "de_DE-kerstin-low.onnx": (PIPER + "kerstin/low/de_DE-kerstin-low.onnx", 20_000_000, 90_000_000),
    "de_DE-kerstin-low.onnx.json": (PIPER + "kerstin/low/de_DE-kerstin-low.onnx.json", 100, 100_000),
}

def install(asset, root):
    url, minimum, maximum = ASSETS[asset]
    destination = root / asset
    if destination.exists() and minimum <= destination.stat().st_size <= maximum:
        print("Voice model already present:", asset, flush=True)
        return
    root.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".voice-download-", dir=root)
    digest = hashlib.sha256()
    total = 0
    try:
        with os.fdopen(fd, "wb") as output:
            request = Request(url, headers={"User-Agent": "SiteOps-Video-Studio/1.0"})
            with urlopen(request, timeout=120) as response:
                if not response.geturl().startswith("https://"):
                    raise RuntimeError("Voice download must stay on HTTPS")
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > maximum:
                        raise RuntimeError("Oversized voice asset " + asset)
                    digest.update(chunk)
                    output.write(chunk)
        if total < minimum:
            raise RuntimeError("Incomplete voice asset " + asset)
        os.chmod(name, 0o640)
        os.replace(name, destination)
        print("Installed", asset, total, "bytes", "sha256", digest.hexdigest(), flush=True)
    finally:
        if os.path.exists(name):
            os.remove(name)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", default="/models")
    parser.add_argument("--language", choices=["all", "en", "de"], default="all")
    args = parser.parse_args()
    names = list(ASSETS)
    if args.language == "en":
        names = [x for x in names if x.startswith(("kokoro", "voices"))]
    elif args.language == "de":
        names = [x for x in names if x.startswith("de_DE-")]
    for name in names:
        install(name, Path(args.models_dir))

if __name__ == "__main__":
    main()
