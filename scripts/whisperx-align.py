#!/usr/bin/env python3
"""Local WhisperX adapter. Dependencies and models are intentionally operator-managed."""

import argparse
import json
import os
import sys


def aligned_tokens(confirmed_text: str, aligned_chars: list, duration_seconds: float) -> list:
    """Preserve candidate timing, but mark every synthetic fallback for Owner review."""
    exact = "".join(str(char.get("char", "")) for char in aligned_chars) == confirmed_text
    tokens = []
    duration_ms = round(duration_seconds * 1000)
    for index, character in enumerate(confirmed_text):
        char = aligned_chars[index] if exact and index < len(aligned_chars) else {}
        fallback_start = round(duration_ms * index / max(1, len(confirmed_text)))
        fallback_end = round(duration_ms * (index + 1) / max(1, len(confirmed_text)))
        has_timing = char.get("start") is not None and char.get("end") is not None
        start_ms = round(float(char["start"]) * 1000) if has_timing else fallback_start
        end_ms = round(float(char["end"]) * 1000) if has_timing else fallback_end
        valid = has_timing and start_ms >= 0 and end_ms > start_ms and end_ms <= duration_ms
        if end_ms <= start_ms:
            end_ms = start_ms + 1
        tokens.append({"text": character, "startMs": start_ms, "endMs": end_ms,
                       "confidence": float(char["score"]) if valid and char.get("score") is not None else 0})
    return tokens


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--confirmed-text-stdin", action="store_true")
    args = parser.parse_args()

    if args.model != "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn":
        raise RuntimeError("冻结模型与本地强制对齐模型不一致；请重新创建当前任务。")
    os.makedirs(args.cache_dir, exist_ok=True)
    matplotlib_cache = os.environ.get("MPLCONFIGDIR") or os.path.join(args.cache_dir, ".matplotlib")
    os.makedirs(matplotlib_cache, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", matplotlib_cache)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    try:
        import torch
        import whisperx
    except ImportError as exc:
        raise RuntimeError("本地 Worker 尚未安装 whisperx/torch；请由环境管理员安装后重试。") from exc

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if not args.probe and not args.audio:
        raise RuntimeError("缺少冻结音频路径。")
    audio = whisperx.load_audio(args.audio) if not args.probe else None
    confirmed_text = sys.stdin.read().strip() if args.confirmed_text_stdin else ""
    if not args.probe and not confirmed_text:
        raise RuntimeError("缺少 Owner 已确认正文，无法执行强制对齐。")
    duration_seconds = max(0.001, len(audio) / 16000) if audio is not None else 0
    align_model, metadata = whisperx.load_align_model(
        language_code="zh",
        device=device,
        model_dir=args.cache_dir,
        model_name=args.model,
        model_cache_only=True,
    )
    if args.probe:
        print(json.dumps({"ready": True, "offline": True, "model": args.model}), flush=True)
        return
    aligned = whisperx.align(
        [{"text": confirmed_text, "start": 0, "end": duration_seconds}],
        align_model,
        metadata,
        audio,
        device,
        return_char_alignments=True,
    )
    aligned_chars = [char for segment in aligned.get("segments", []) for char in segment.get("chars", [])]
    tokens = aligned_tokens(confirmed_text, aligned_chars, duration_seconds)
    print(json.dumps({"model": args.model, "tokens": tokens}, ensure_ascii=False), flush=True)
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
