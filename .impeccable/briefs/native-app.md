# Loop Control interactive prototype

Mode: Operate

## Direction contract

THESIS: Make the next creative decision clear without losing the episode context; avoid the generic KPI-card dashboard.

OWN-WORLD: Cool blue-grey ground, deep cobalt navigation, white task surfaces, blue selection, amber pending decisions, pine completed states. System sans at 12/14/16/24 pixels, tabular values, disciplined aligned rows, compact standard controls. The signature is a continuous episode phase trace connecting table selection, production detail and review.

STORY: The Owner sees what needs attention, opens the same episode, provides inputs, makes creative decisions, previews shots, edits, approves QC and obtains a verified delivery package. Secondary operations remain one navigation action away.

FIRST VIEWPORT: A 200-pixel cobalt rail; a 64-pixel context/search bar; workspace title and new-episode action; a filterable production table in the main column; a 300-pixel continuation inspector with authored title-frame preview, phase trace and next task. No statistic-card wall.

FORM: Modern colour-study plates, grounded candidate 6; seed:0f9042558ec4d9d9. User delegated choice. Code-led. The source lends palette, type, density and the linked phase trace; navigation and controls remain standard product UI.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Boundaries
All shipping UI is in index.html. Development files and evidence stay outside its served directory. All content/effects are synthetic. Existing repository and installed skills stay untouched.


## Real application migration, 2026-10-28

The user accepted this code-led prototype and explicitly authorized migration into the real application while preserving business and data logic. Native React entry: src/local-app/main.tsx. Visual system: src/ui/impeccable/*.css.

Product-truth adaptations: catalog exposes no media preview paths, so the home uses real episode rows plus pending-package/blocker queues; selecting an episode opens the actual full production context. Counts use their original independent scopes. Prototype navigation consolidates into seven native entry points; blueprint/series remain account tabs, security/secrets remain permission-gated Owner overlays. Prototype timeline is not substituted for the real OpenChatCut engine: project-owned entry, replacement conflicts and revision workflows retain actual commands. Seven-stage track reports current state and does not grant editing rights to other phases. Single actual episode is not padded with mock rows. Existing historical read-only and registered Provider choices remain authoritative.

Mode: Operate. PC-first; narrow-window navigation remains usable. Mock media, arbitrary credentials and fake export never enter runtime.
