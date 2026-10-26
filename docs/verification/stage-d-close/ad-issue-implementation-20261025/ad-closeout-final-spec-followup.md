## #136 / C05 follow-up

### Closing assessment

**C05 is sufficient to close within its stated scope.** The evidence is a new, current isolated-database run, not a historical replay or a cold-environment claim. `039` was applied only to `loop_t24_restore_adclose20261025`, with prior migration records unchanged.

### Criteria evidence

- The new real WhisperX speech run completed at 0.982125 while still requiring Owner text confirmation. A new real mismatched-text run completed at 0.838090909 and still required confirmation; the actual Chrome state shows the mismatch and manual-review requirement. This directly preserves the high-score counterexample rather than promoting it to verified text.
- The Owner reported listening to the current audio and matching text. The real Chrome button saved confirmation; browser reload and two fresh HTTP reads retained it. Both sync-preview commands returned 409 before confirmation, including after the mismatched text path, with no task created.
- A real current silence route used normal Owner import, clip, and source-audio extraction; it changed the audio identity, rejected the old tuple with 409, and the new WhisperX run reached `needs_review` at 0.124375. It was not treated as success.
- A true delayed model result was paused only after real alignment and then released. It could not overwrite the newer text/timing, revive the confirmation, or accept the old Owner tuple; prior artifact SHA stayed unchanged. No timestamp or lease was mutated. The actual PostgreSQL trigger separately cleared confirmation and legacy confirmation fields after a real new-track identity change; worker and anonymous roles were rejected.

### Limits retained

- This closes #136/C05 only. The reused prepared venv/cache passed the unchanged 30-second probe without downloads, but this is explicitly not #135 cold-environment acceptance.
- Historic 0.838 and cold-probe failures remain preserved. No Provider requests occurred.

No additional #136 spec gap found.
