import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
export async function productionWorkspaceFixture(options:Parameters<typeof embeddedStudioFixture>[0]={}){
 const f=await embeddedStudioFixture({...options,migrations:[...new Set(['db/local/084-four-step-workspace.sql','db/local/086-workspace-images.sql','db/local/087-workspace-narration.sql','db/local/088-workspace-audio.sql','db/local/089-workspace-captions.sql','db/local/090-workspace-candidates.sql','db/local/091-workspace-visual-candidates.sql','db/local/092-workspace-shot-caption-identity.sql','db/local/093-workspace-export.sql','db/local/094-workspace-delivery.sql','db/local/095-formal-workflow.sql','db/local/096-workspace-episode-deletion.sql','db/local/097-workspace-image-generation.sql','db/local/098-workspace-formatting-resume.sql','db/local/100-production-request-selection.sql',...(options.migrations??[])])].sort()});
 try{
  const script=randomUUID(),material=randomUUID(),path=`episodes/${f.episode}/script.md`,bytes=Buffer.from('已确认的第一镜。\n缺少素材的第二镜。');
  await writeFile(join(f.assetRoot,path),bytes);
  await f.c.query("INSERT INTO public.production_material_revisions(id,episode_id,revision_number,material_type,source_kind,source_path,storage_path,mime_type,sha256,file_size,is_main_script,created_by,material_purpose) VALUES($1,$2,1,'script','paste',$3,$3,'text/markdown',$4,$5,true,$6,'main_script'),($7,$2,2,'video','file',$8,$8,'video/mp4',$9,$10,false,$6,'a_roll')",[script,f.episode,path,createHash('sha256').update(bytes).digest('hex'),bytes.length,f.owner,material,f.videoPath,f.files[0].sha256,f.files[0].fileSize]);
  await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved',title='四步制作 T02 验收' WHERE id=$1",[f.episode,script]);
  const board=JSON.parse(await readFile(join(f.assetRoot,f.boardPath),'utf8'));board.shots.push({...board.shots[0],id:'shot-2',scriptSegment:'缺少素材的第二镜。'});
  const boardBytes=Buffer.from(JSON.stringify(board));await writeFile(join(f.assetRoot,f.boardPath),boardBytes);
  await f.c.query('UPDATE public.artifacts SET sha256=$2,file_size=$3 WHERE episode_id=$1 AND relative_path=$4',[f.episode,createHash('sha256').update(boardBytes).digest('hex'),boardBytes.length,f.boardPath]);
  await f.c.query("UPDATE public.review_packages SET context_snapshot=$2 WHERE id=$1",[f.board,{worker_result:{storyboard:board}}]);
  async function fillVisuals(workspace:any){let w=workspace;for(const clip of workspace.clips.filter((b:any)=>workspace.readiness.placeholders.includes(b.itemId))){const r=await f.request('matchWorkspaceMaterial',{workspaceId:w.id,expectedRevision:w.revision,clipId:clip.id,materialRevisionId:material});if(r.status!==200)throw Error(JSON.stringify(r.body));w=r.body;}return w;}
  return{...f,script,material,fillVisuals};
 }catch(error){await f.close();throw error;}
}
