#!/usr/bin/env python3
"""Local WhisperX adapter. Dependencies and models are intentionally operator-managed."""

import argparse
import json
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--confirmed-text-stdin", action="store_true")
    args = parser.parse_args()

    os.makedirs(args.cache_dir, exist_ok=True)
    matplotlib_cache = os.environ.get("MPLCONFIGDIR") or os.path.join(args.cache_dir, ".matplotlib")
    os.makedirs(matplotlib_cache, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", matplotlib_cache)
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    try:
        import torch
        import whisperx
    except ImportError as exc:
        raise RuntimeError("本地 Worker 尚未安装 whisperx/torch；请由环境管理员安装后重试。") from exc

    device = "cuda" if torch.cuda.is_available() else "cpu"
    audio = whisperx.load_audio(args.audio)
    confirmed_text = sys.stdin.read().strip() if args.confirmed_text_stdin else ""
    if not confirmed_text:
        raise RuntimeError("缺少 Owner 已确认正文，无法执行强制对齐。")
    duration_seconds = max(0.001, len(audio) / 16000)
    align_model, metadata = whisperx.load_align_model(
        language_code="zh",
        device=device,
        model_dir=args.cache_dir,
        model_cache_only=True,
    )
    aligned = whisperx.align(
        [{"text": confirmed_text, "start": 0, "end": duration_seconds}],
        align_model,
        metadata,
        audio,
        device,
        return_char_alignments=True,
    )
    aligned_chars = [char for segment in aligned.get("segments", []) for char in segment.get("chars", [])]
    exact_alignment = "".join(str(char.get("char", "")) for char in aligned_chars) == confirmed_text
    tokens = []
    duration_ms = round(duration_seconds * 1000)
    for index, character in enumerate(confirmed_text):
        aligned_char = aligned_chars[index] if exact_alignment and index < len(aligned_chars) else {}
        fallback_start = round(duration_ms * index / max(1, len(confirmed_text)))
        fallback_end = round(duration_ms * (index + 1) / max(1, len(confirmed_text)))
        start_ms = round(float(aligned_char["start"]) * 1000) if aligned_char.get("start") is not None else fallback_start
        end_ms = round(float(aligned_char["end"]) * 1000) if aligned_char.get("end") is not None else fallback_end
        if end_ms <= start_ms:
            end_ms = start_ms + 1
        token = {
            "text": character,
            "startMs": start_ms,
            "endMs": end_ms,
        }
        if aligned_char.get("score") is not None:
            token["confidence"] = float(aligned_char["score"])
        tokens.append(token)
    print(json.dumps({"model": "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn", "tokens": tokens}, ensure_ascii=False), flush=True)
    # Some macOS ML dependencies leave non-daemon telemetry/download threads
    # alive after inference. This process is a one-shot JSON adapter, so once
    # stdout is flushed there is no cleanup contract left for the Worker to wait on.
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # the Node runner turns stderr and exit status into a shot-scoped failure
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
