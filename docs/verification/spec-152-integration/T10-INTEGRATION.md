# Native editing integration acceptance

T10 merged without conflicts at `acb807f1`, preserving delivery/export/094 fences and versioned controlled media. Independent verification passed TypeScript, 42 affected tests and 11 real isolated Owner HTTP/PG/Studio/native render cases. These include multi-range voice/caption retention, source dimensions, native locks/composition, added visuals, portrait/landscape caption pixels and exact export confirmation/invalidation.

The merger reproduced a missing native-save guard: deleting the active final visual and parking it in an unreachable timeline could still register a new workspace SHA. Correction `c045934c` validates actual used visuals before persistence. Existing used video/image cannot be deleted to zero; initial nonempty all-placeholder drafts remain editable. Rejected native documents remain recoverable; old workspace/source bytes are unchanged.

After correction, two new public save cases and four affected Owner/Studio cases passed, plus TypeScript and 42 affected tests. The earlier full 11-case native-render run was not repeated wholesale after this selective guard change. `npm run build` followed by `npm run runtime:prepare` passed and retained the actual CLI artifact. No daily runtime, paid Provider or deployment was used. Full workflow acceptance and final unified review remain pending.

Reproduction: with the documented isolated runtime context, run `workspaceShots.integration.test.ts`, `workspaceCaptions.integration.test.ts` and `workspaceExport.integration.test.ts` serially using `LOOP_WORKSPACE_ACCEPTANCE=1`. Native render currently uses an internal engine port; coordinate concurrent suites.
