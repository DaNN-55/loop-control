# Controlled workspace media

Synthetic FFmpeg inputs for native HTTP/Worker/render acceptance; no production media.

- `landscape-red-blue.mp4`: 640x360, 30fps, red at 0-2s and blue at 2-4s, 440Hz source audio.
- `portrait-green.mp4`: 360x640, 30fps, 4s green, 660Hz source audio.
- `still-striped.png`: yellow center, magenta left, cyan right.
- `controlled-narration-tone.mp3`: 2.4s 330Hz transport/duration sample; not real speech or TTS quality evidence.

Exact byte hashes/sizes are in `manifest.json`. Test paths resolve relative to the fixture module, so a checkout does not depend on an earlier agent's temporary files. Other mix signals are generated within their own test fixtures.
