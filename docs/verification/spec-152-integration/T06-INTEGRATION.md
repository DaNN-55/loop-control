# Workspace audio integration acceptance

T06 merged without conflicts at 13279530; final independent correction is 90bc9b62. Export/delivery/094, stable shot/caption092, last-effective native-save protection and versioned controlled media remain present.

Independent checks passed TypeScript and 73 directed tests. Actual isolated groups passed: one fresh source-window Worker/MP4, six original non-render audio/planner cases, four caption/save compatibility cases and a new actual Owner/Studio projection case. Five committed mix MP4s were independently decoded with Goertzel; their source/TTS separation, parallel voice amplitude, ambience, ducking and positioned effects matched the recorded spectra within 1e-6. They were not mechanically rerendered.

The fresh window case selects 1–2s from time-distinct source tones: registered audio and native output contain selected660Hz, not440/880Hz, and later serial visuals do not acquire unintended main speech. Partial coverage and retimed entire-shot alignment correctly return409. Real mountpoint protection stays enabled with private test APFS images and exact cleanup.

The merger reproduced an actual native compatibility problem: retained muted old TTS plus audible source projected TTS/-120 despite the actual-voice resolver selecting source. The minimal read-only correction reuses the resolved audible item. Owner/Studio RED/GREEN now reads source/-6 and fully muted none/0, with caption identity, BGM/SFX and re-adopted native trim/gain/duck/fades preserved. One array-order-only assertion was corrected to compare all stable nodes by ID; no product behavior was weakened.

Frontend build preceded runtime:prepare, and all real CLI groups ran on frozen prepared source. Full workflow and source/none-to-new-narration candidate adoption remain later joint acceptance. No daily runtime, paid Provider or deployment was used.

See the source ticket REPORT/CONTRACT under docs/verification/issue-158-workspace-audio/ for reproduction and the original six rendered MP4 scenarios.
