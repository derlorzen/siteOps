#!/usr/bin/env python3
"""Install only pinned, publicly licensed offline voice models on first use.

Model files are downloaded into a writable SiteOps volume, atomically verified
and reused.  No user input can change model URLs or destination filenames.
"""
import argparse
import hashlib
import os
from pathlib import Path
import urllib.request

MODELS = {
    "kokoro": [
        ("kokoro-v1.0.onnx", "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
         "sha256", "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5"),
        ("voices-v1.0.bin", "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
         "sha256", "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d")
    ],
    "piper": [
        ("de_DE-thorsten-medium.onnx",
         "https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx",
         "md5", "a129b00fb3078df43c96bab6c94535c0"),
        ("de_DE-thorsten-medium.onnx.json",
         "https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json",
         "md5", "0ba02428e952e6556157df235b740e93")
    ]
}

def matches(filename, algorithm, expected):
    if not filename.is_file():
        return False
    digest = hashlib.new(algorithm)
    with filename.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == expected

def ensure(provider, destination):
    destination.mkdir(parents=True, exist_ok=True, mode=0o750)
    for filename, url, algorithm, digest in MODELS[provider]:
        target = destination / filename
        if matches(target, algorithm, digest):
            continue
        if target.exists():
            raise RuntimeError("Existing voice model failed integrity verification: " + filename)
        partial = destination / (filename + ".download")
        try:
            with urllib.request.urlopen(urllib.request.Request(
                url, headers={"User-Agent": "SiteOps-VoiceInstaller/1.0"}), timeout=90) as response, partial.open("wb") as output:
                hasher = hashlib.new(algorithm)
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 450 * 1024 * 1024:
                        raise RuntimeError("Voice model exceeds download size limit")
                    output.write(chunk)
                    hasher.update(chunk)
            if hasher.hexdigest() != digest:
                raise RuntimeError("Downloaded model has unexpected checksum: " + filename)
            partial.replace(target)
        finally:
            partial.unlink(missing_ok=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["kokoro", "piper"], required=True)
    parser.add_argument("--directory", default=os.getenv("VIDEO_MODEL_DIR", "/data/video-studio/models"))
    args = parser.parse_args()
    ensure(args.provider, Path(args.directory))
