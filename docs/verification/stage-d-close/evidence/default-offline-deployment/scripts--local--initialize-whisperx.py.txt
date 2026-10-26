"""Explicit offline dependency initialization, before the unchanged 30-second model probe."""
import os
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1", DO_NOT_TRACK="1")
import importlib.metadata
import json
import sys
import torch
import whisperx.alignment
print(json.dumps({"python": sys.version.split()[0], "packages": {d.metadata["Name"].lower().replace("_", "-"): d.version for d in importlib.metadata.distributions()}}), flush=True)
