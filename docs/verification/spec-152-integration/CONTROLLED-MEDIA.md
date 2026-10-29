# Controlled acceptance inputs

Four small synthetic media inputs are versioned in `src/local-app/fixtures/workspace-media/`, with exact hashes and sizes in `manifest.json`. `workspaceTestMedia()` resolves them relative to the fixture module. Production media is not copied.

Before this change, the real HTTP test `Owner moves a locked range by exactly one frame in real native output` failed with ENOENT when a test-only Node preload denied reads under the previous orchestration scratch media directory. After replacing the path with the versioned fixture, the same command and denial condition passed: 1 passed, 5 unrelated scenarios skipped. The real isolated database, HTTP boundary, native rendering and one-frame output assertion were retained. TypeScript check and diff check passed.

The denial preload only changes reads in that test process; it does not remove or alter another worker's temporary inputs. The narration fixture default is being migrated by the audio implementer, who owns that file. Full workflow acceptance remains pending.
