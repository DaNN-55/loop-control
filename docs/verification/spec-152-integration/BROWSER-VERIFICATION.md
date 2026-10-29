# Browser measurement boundary

An independent standard Chrome156 / fresh-profile / single-CDP-client check at800x720 passed three native-property off/on rounds with Host tools closed, three with the real caption tool expanded, and three in the same standalone Studio document. Stable-state parent/child double-rAF responses were2–26ms. Actual inspector states and DOM geometry were checked.

This data uses a portrait4s project with two video ranges, a placeholder and one caption; it does not independently establish the two-image/narration candidate scenario. Expanded captions were mounted, but only the heading and textarea upper edge were initially in view. Full-form same-screen usability remains part of final workflow verification.

A separate retained failure showed a relevant test-tool effect: switching tool windows made the headed browser and child hidden/focus=false. Both rAF probes timed out8s while synchronous DOM queries remained responsive. Activating the owned browser and completing actions/measurement in one CDP command produced visible passing results. This proves background scheduling can produce that signal; it does not prove every earlier timeout had that cause.

A first standalone property-close click also missed because the nominal button center was covered by the inspector heading. Hit testing and screenshots identified the real visible close control. Formal tests must check actual visibility, hit target and resulting state before timing; forced clicks or hidden rAF timeouts are not foreground UI evidence.

The independent report and raw observations are retained in the orchestration T06-NATIVE-PROPERTIES-CHECK.md evidence directory. No user's Chrome profile was changed. Owned browser, fixture database and media were cleaned. T08 uses standard Chrome for its final candidate flow and removes unproven layout experiments.
