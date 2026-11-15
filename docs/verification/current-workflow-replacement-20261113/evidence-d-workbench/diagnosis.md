# D workbench diagnosis

- Valid initial recorded fixture: new source GET returned404 before implementation.
- Old studio_audio_members/studio_duration_settings acquire locks and cannot serve a READ ONLY snapshot; direct table reads also hit existing ACLs. Preserve ACLs, add197 scoped function rather than widening grants.
- Typed adapter exposed old generated Json/optional fields; add explicit historical source types and existing parsers, no TS ignore/config relaxation.
- Source HTTP must preserve404 for a different Owner; SQL still denies42501.
- Invalidated-preview fixture initially violated reason constraint; actual column is invalidated_reason, keep constraint and fix fixture. Original invalidated-path behavior not yet proven red until valid fixture runs.
- Valid invalidated preview test maHui6 reproduced200 instead409. Add explicit invalidated_at guard; final matrix this case passes.
- uW63su: full type passed, migration and6negative cases passed; delivery503 was the fixture wake callback throwing No generation permitted after queueing, not a production queue error. Allow local wake in this fixture (no background scheduler), retain No Provider check and execute the real isolated delivery Worker explicitly.
- vjQMQE: queued local delivery, actual Worker rejected missing scheduler capacity. Configure real isolated scheduler capacity2 as formalWorkflow fixture does; do not alter claim eligibility/guards. Six old editing cases were not enabled by env in that diagnostic run; final run explicitly sets LOOP_LEGACY_EDIT_ACCEPTANCE=1.
