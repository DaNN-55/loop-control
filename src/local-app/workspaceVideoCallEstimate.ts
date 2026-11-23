import type {PoolClient} from 'pg';
import type {resolveWorkspaceVideoRequest} from './workspaceVisualRequest.js';
import {estimateWorkspaceCall} from './workspaceCallEstimate.js';

export async function estimateWorkspaceVideoCall(c:PoolClient,request:Awaited<ReturnType<typeof resolveWorkspaceVideoRequest>>){
 const {resolved,visual}=request;
 // The credential region determines MiniMax pricing, even with a legacy endpoint.
 const region=resolved.selection.provider==='minimax'&&resolved.connection?(await c.query("SELECT metadata->>'region' region FROM local_identity.connection_intents WHERE version_id=$1 AND owner_id=local_identity.owner_id() AND applied_at IS NOT NULL AND metadata->>'provider'='minimax' AND metadata->>'command' IN ('create','rotate') ORDER BY created_at DESC LIMIT 1",[resolved.connection.id])).rows[0]?.region??'international':undefined;
 return {region,estimate:estimateWorkspaceCall({
  kind:'video',provider:resolved.selection.provider,model:resolved.selection.model,seconds:request.providerSeconds,
  videoResolution:request.videoResolution,videoSettings:request.videoSettings as Parameters<typeof estimateWorkspaceCall>[0]['videoSettings'],text:request.actualPrompt,
  referenceVideoSeconds:visual.referenceVideoSeconds,referenceVideoDurations:visual.referenceVideoDurations,
  videoImageCount:visual.frozen.filter(input=>input.role!=='referenceVideos').length,region,
 })};
}
