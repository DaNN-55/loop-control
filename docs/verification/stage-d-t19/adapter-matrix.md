# T19 Adapter coverage plan (before generation)

Scope: local ticket #125; dependency T17 committed as d06b2a5. Published ticket/cache read offline; GitHub current state not refreshed. Native PG in existing stage-d container only.

| Family | Registered path | Planned evidence | Live status |
|---|---|---|---|
| Static visual | openai/openai_images; cloudflare/workers_ai_images | Reuse original visual generation algorithm; controlled responses + real image/index/preview | Both unaccepted online |
| A-roll | openchatcut/openchatcut_card_video | Real local render representative | Default deployment unaccepted |
| B-roll | openchatcut/openchatcut_card_video; pexels/pexels_video | Local card + controlled search/download representative | Pexels generation unaccepted online; T15 connection probe separate |
| Manual A/B | manual_upload + internal ffmpeg_trim_video | Owner upload/bind/replace; real trim | No external request |
| Audio | manual narration/BGM/SFX; freesound/freesound_preview | Existing track binding + controlled search/download/trim | Freesound unaccepted online |
| Embedded audio | ffmpeg/ffmpeg_extract_audio | Existing source extraction, actual ffmpeg | Local only |
| Narration | google_tts/google_tts; volcengine_tts/volcengine_tts | T18 compatibility regression; no new live calls | Controlled qualifications/SecretStore substitute remain unaccepted live |
| Alignment/Studio/final delivery | whisperx / openchatcut render | Out of T19 claim scope; remain deferred | Not T19 acceptance |

All registered Adapters stay registered. Missing representative/runtime evidence must remain explicit in final report. Controlled Provider fixtures seed qualification metadata and replace SecretStore; they are not real live qualification or Keychain evidence. No online requests authorized.

## Actual outcome

Native HTTP/PG/CLI completed all seven fixture families. Product Chrome decoded PNG/JPEG, played Pexels MP4, Freesound BGM/SFX MP3 and local A/B cards; manual upload/source clip/BGM selection survived refresh. Embedded audio extraction used real ffmpeg. Before-fix cards rendered only checker background because text used a caption track; mapping to V1/video restored visible frozen text. Images are 1x1 synthetic decoding fixtures, not image-quality proof. All external responses and SecretStore were substitutes, qualifications were seeded and later revoked, online requests=0. Default 5000ms final regression: 739/740, NOT PASSED; historical gate/root-cause limitation retained. No T20 claim.
