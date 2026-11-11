import {requiresWorkspaceCall} from '../workspaceCall';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
export const productionWorkspaceMigrations=['db/local/084-four-step-workspace.sql','db/local/086-workspace-images.sql','db/local/087-workspace-narration.sql','db/local/088-workspace-audio.sql','db/local/089-workspace-captions.sql','db/local/090-workspace-candidates.sql','db/local/091-workspace-visual-candidates.sql','db/local/092-workspace-shot-caption-identity.sql','db/local/093-workspace-export.sql','db/local/094-workspace-delivery.sql','db/local/095-formal-workflow.sql','db/local/096-workspace-episode-deletion.sql','db/local/097-workspace-image-generation.sql','db/local/098-workspace-formatting-resume.sql','db/local/100-production-request-selection.sql','db/local/101-production-video-selection.sql','db/local/102-workspace-pexels.sql','db/local/103-workspace-speech-selection.sql','db/local/104-production-audio-selection.sql','db/local/107-retire-blueprint-reviews.sql','db/local/108-content-blueprint-preparation-selection.sql','db/local/109-workspace-generation-deletion.sql','db/local/130-workspace-manual-narration.sql','db/local/131-retire-account-generation-budgets.sql','db/local/134-workspace-call-confirmations.sql','db/local/135-workspace-call-confirmation-lifecycle.sql','db/local/136-workspace-generation-reconciliation.sql','db/local/137-workspace-audio-defaults.sql','db/local/139-global-storyboard-planning.sql','db/local/140-script-first-storyboard.sql','db/local/141-local-workspace-storyboard.sql','db/local/142-workspace-video-progress.sql','db/local/143-workspace-unknown-image-retry.sql','db/local/144-workspace-video-submission-guard.sql','db/local/146-workspace-unassigned-audio.sql','db/local/147-workspace-visual-removal.sql','db/local/148-workspace-seedance-visual-inputs.sql','db/local/149-workspace-official-video-inputs.sql','db/local/150-workspace-reference-video-models.sql','db/local/154-workspace-narration-caption-preservation.sql','db/local/158-workspace-unused-queued-tasks.sql','db/local/159-owned-studio-freeze-registration.sql','db/local/160-episode-recycle-bin.sql','db/local/161-provider-dispatch-facts.sql','db/local/162-confirmed-narration-unknown-retry.sql','db/local/163-legacy-received-explicit-retry.sql'];
export async function productionWorkspaceFixture(options:Parameters<typeof embeddedStudioFixture>[0]={}){
 const f=await embeddedStudioFixture({...options,migrations:[...new Set([...productionWorkspaceMigrations,...(options.migrations??[])])].sort()});
 try{
  const script=randomUUID(),material=randomUUID(),path=`${f.episodeRelativePath}/script.md`,bytes=Buffer.from('已确认的第一镜。\n缺少素材的第二镜。');
  await writeFile(join(f.assetRoot,path),bytes);
  await f.c.query("INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES($1,$2,1,'script','paste',$3,$3,'text/markdown',$4,$5,true,$6,'main_script'),($7,$2,2,'video','file',$8,$8,'video/mp4',$9,$10,false,$6,'a_roll')",[script,f.episode,path,createHash('sha256').update(bytes).digest('hex'),bytes.length,f.owner,material,f.videoPath,f.files[0].sha256,f.files[0].fileSize]);
  await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved',title='四步制作 T02 验收' WHERE id=$1",[f.episode,script]);
  const board=JSON.parse(await readFile(join(f.assetRoot,f.boardPath),'utf8'));board.shots.push({...board.shots[0],id:'shot-2',scriptSegment:'缺少素材的第二镜。'});
  const boardBytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),boardBytes);
  await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE episode_id=$1 AND relative_path=$4',[f.episode,createHash('sha256').update(boardBytes).digest('hex'),boardBytes.length,f.boardPath]);
  await f.c.query("UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1",[f.board,{worker_result:{storyboard:board}}]);
  async function fillVisuals(workspace:any){let w=workspace;for(const clip of workspace.clips.filter((b:any)=>workspace.readiness.placeholders.includes(b.itemId))){const r=await f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,materialRevisionId:material});if(r.status!==200)throw Error(JSON.stringify(r.body));w=r.body;}return w;}
  const request:typeof f.request=async(command,data={},options={})=>{
   if(!requiresWorkspaceCall(command,data))return f.request(command,data,options);
   const payload={episodeId:f.episode,...data};
   const proposal=await f.request('prepareWorkspaceCall',{episodeId:payload.episodeId,workspaceId:data.workspaceId,expectedRevision:data.expectedRevision,callCommand:command,callData:payload},options);
   if(proposal.status!==200)return proposal;
   return f.request('confirmWorkspaceCall',{episodeId:payload.episodeId,workspaceId:data.workspaceId,expectedRevision:data.expectedRevision,confirmationId:proposal.body.confirmationId},options);
  };
  return{...f,request,rawRequest:f.request,script,material,fillVisuals};
 }catch(error){await f.close();throw error;}
}
