# Native SDK findings — caption lane key collision

Date: 2026-11-01. Scope: the isolated main E2E native Studio only. No shared
OpenChatCut source, production source, provider credential, browser session, or
daily runtime was changed.

## Finding

The native Studio console warning is reproducible from the persisted, adopted
caption shape. It is not a duplicate cue in the Loop Control workspace.

The actual two caption lanes have stable lane IDs and valid lane-local cue IDs:

| Lane | Cue IDs |
| --- | --- |
| `workspace-caption-shot-shot-01` | `phrase-1~0` |
| `workspace-caption-shot-shot-02` | `phrase-1~0`, `phrase-2~0` |

`phrase-1~0` is intentionally reused by separate WhisperX alignment results;
the owning lane is its namespace. The saved workspace reports both captions as
`timing: "current"` and `textConfirmed: true`.

## Root cause

`OpenChatCut/src/captions/useCaptionCueGestures.ts:55-62` creates
`manualCueTargets` as a `Map` keyed only by `word.id`. The later shot-02
`phrase-1~0` overwrites the target for shot-01 `phrase-1~0`.

`OpenChatCut/src/captions/CaptionTrackLane.tsx:184,304-316` then calls
`captionPages`, which returns pages without lane identity, and again looks up
the target by bare `word.id`. Both pages consequently resolve to shot-02 and
produce this same React child key:

```
workspace-caption-shot-shot-02:phrase-1~0
```

The source of truth does retain lane identity:
`OpenChatCut/src/captions/captionPages.ts:58-67,79-104` returns
`CaptionPageIdentity.laneId` from `buildCaptionPages`.

## Red-capable minimal reproduction

Run in the installed OpenChatCut root; this runs source in memory and creates
no build output:

```sh
node --import tsx --input-type=module -e "import assert from 'node:assert/strict'; import { captionPages } from './src/captions/exportCaptions.ts'; import { manualCueTargets } from './src/captions/useCaptionCueGestures.ts'; const captions={enabled:true,template:'plain',pacing:'phrase',sourceEntries:[{id:'workspace-caption-shot-shot-01',itemId:'manual:workspace-caption-shot-shot-01',words:[{id:'phrase-1~0',text:'one',start:61,end:1204}]},{id:'workspace-caption-shot-shot-02',itemId:'manual:workspace-caption-shot-shot-02',words:[{id:'phrase-1~0',text:'two',start:1314,end:2041},{id:'phrase-2~0',text:'three',start:2364,end:3233}]}]}; const targets=manualCueTargets(captions); const keys=captionPages(captions,[],30).map((page,index)=>{const id=page.words[0]?.id;const target=id?targets.get(id):undefined;return target ? target.laneId+':'+id : page.start+':'+index;}); console.log(JSON.stringify(keys)); assert.equal(new Set(keys).size,keys.length,'timeline cue React keys must be unique across manual caption lanes');"
```

Observed red result:

```
["workspace-caption-shot-shot-02:phrase-1~0","workspace-caption-shot-shot-02:phrase-1~0","workspace-caption-shot-shot-02:phrase-2~0"]
AssertionError: 2 !== 3
```

## Minimal product repair and regression

Do not change the cue-ID domain to global IDs. Keep the persisted contract
lane-local and make the UI lookup scoped:

1. Key `manualCueTargets` by `(laneId, cueId)` (a single canonical helper or
   nested map), not `cueId` alone.
2. In `CaptionTrackLane`, use `buildCaptionPages` rather than the lane-erasing
   `captionPages` facade, and resolve the target with its `laneId` plus the
   page cue ID.
3. Add the reproduction above as a real SDK verification (preferably alongside
   `captionPagination.verify.ts`, which is included in
   `verify:production-contracts`). Assert three distinct keys and that each
   page targets its own lane. This must fail before the repair and pass after
   it; a data-only `workspaceCaptions` test would not cover the bad UI lookup.

## Impact and status

The duplicate React key can cause reconciliation to reuse the wrong timeline
cue element: shot-01 can visually/interaction-wise target shot-02 for select,
drag, trim, or delete. Caption render/output and confirmation are not proven
invalid solely by this warning. The current persisted E2E state still has
distinct lane data and valid caption confirmation; confirmation derives from
caption evidence fingerprints, not React child keys. Recheck native visual
selection/editing and final rendered captions after the SDK fix.

This is an SDK timeline integration defect, unrelated to #178 account storage
layout. It remains **unfixed** in this repository at this record's time.

## SDK export observation (not root-caused)

The native dialog default `downloads` destination is supported:
`exportDestinationModel.ts:69-78` accepts it and
`exportDestination.ts:284-287` downloads the completed blob. Selecting a local
directory is not required before export. If target-path setup fails,
`useExportWorkflow.ts:188-194` stores the error and
`ExportDialogMain.tsx:96-99` renders it. The observed dialog had neither a job
nor visible error, so the available read-only evidence does not identify its
early exit. The formal Loop Control step-4 `exportWorkspace` flow remains the
appropriate delivery path; SDK export needs a separately instrumented repro.

## Follow-up verification

The Loop Control embedded and standalone adapters now preserve lane-qualified cue identity. Actual SDK component regressions and a browser edit persisted/reloaded through SQLite pass. SDK export success, missing-media failure feedback and retry were also verified. The historical no-job observation and process termination trigger remain unproven. See [follow-up report](../native-studio-fixes-20261101/REPORT.md). This does not modify or release the installed upstream SDK.
