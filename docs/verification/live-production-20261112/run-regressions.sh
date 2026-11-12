#!/bin/bash
set -euo pipefail
export LOOP_WORKSPACE_ACCEPTANCE=1 LOOP_RECYCLE_ACCEPTANCE=1 LOOP_EPISODE_ARCHIVE_ACCEPTANCE=1 LOOP_EPISODE_DELETION_ACCEPTANCE=1 LOOP_EMBEDDED_STUDIO_ACCEPTANCE=1
node docs/verification/live-production-20261112/prepare-regressions.mjs
export LOOP_TEST_CONTEXT_MODULE="$PWD/docs/verification/live-production-20261112/test-context.mjs"
export OPENCHATCUT_ROOT="$PWD/.scratch/live-production/IntegrationOpenChatCut"
export LOOP_TEST_OPENCHATCUT_ROOT="$OPENCHATCUT_ROOT"
npx vitest run \
 src/local-app/materialReimport.integration.test.ts \
 src/local-app/receiptRules.integration.test.ts src/local-app/commandReceipt.integration.test.ts \
 src/local-app/workspaceGenerationState.integration.test.ts \
 src/local-app/workflowRules.integration.test.ts src/local-app/workflowRetryRules.independent.integration.test.ts \
 src/local-app/workflowQueueStop.independent.integration.test.ts src/local-app/workflowLegacyRules.integration.test.ts \
 src/local-app/recycleBin.integration.test.ts src/local-app/recycleBin.independent.integration.test.ts \
 src/local-app/episodeArchive.integration.test.ts src/local-app/episodeDeletion.integration.test.ts src/local-app/episodeDeletionRetainedSources.integration.test.ts \
 src/local-app/workspaceScriptResume.integration.test.ts src/local-app/workspaceCaptions.integration.test.ts \
 src/local-app/workspaceCandidates.integration.test.ts src/local-app/workspacePexels.integration.test.ts \
 src/local-app/workspaceDeliveryInputs.integration.test.ts src/local-app/workspaceDelivery.integration.test.ts \
 src/local-app/workspaceNarrationTabs.integration.test.ts src/local-app/workspaceAudioStorage.integration.test.ts \
 src/local-app/blueprintContraction.integration.test.ts src/local-app/workspaceCandidateImpact.integration.test.ts \
 --maxWorkers=1 --fileParallelism=false --reporter=default --reporter=json \
 --outputFile=docs/verification/live-production-20261112/regressions.json
