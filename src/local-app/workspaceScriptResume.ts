import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {episodeStorageLocationAtRoot} from './episodeStorageLocation.js';
import {verifyEpisodeFile} from './episodeFiles.js';
import {verifyProductionPreparationSource,verifyProductionPreparationDocument} from './productionPreparationStore.js';
import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';
import type {ProductionWorkspaceRecord} from './productionWorkspaceCommands.js';

/** Keep word boundaries; only remove the supported presentation marks and CJK line wrapping. */
function scriptBody(text:string){
 return text.split(/\r?\n/).filter(line=>!/^\s*#{1,6}\s+正文\s*$/.test(line)).map(line=>line.replace(/^\s*#{1,6}\s+/,'').replace(/^\s*>\s?/,'' )).join('\n').trim().replace(/([\p{Script=Han}，。！？；：、])\s+(?=[\p{Script=Han}，。！？；：、])/gu,'$1');
}
export async function readWorkspaceScriptResume(c:PoolClient,root:string,row:ProductionWorkspaceRecord,currentScript:string|null,stage:string){
 if(!currentScript||currentScript===row.script_revision_id||stage!=='waiting_input')return undefined;
 try{
  const materials=(await c.query('SELECT id,storage_path,sha256,file_size FROM public.production_material_revisions WHERE episode_id=$1 AND id=ANY($2::uuid[]) AND is_main_script',[row.episode_id,[row.script_revision_id,currentScript]])).rows;
  if(materials.length!==2)throw Error();
  const texts=await Promise.all(materials.map(async m=>(await verifyEpisodeFile(c,root,row.episode_id,m.storage_path,m.sha256,Number(m.file_size))).toString('utf8')));
  const canReuse=!!scriptBody(texts[0])&&scriptBody(texts[0])===scriptBody(texts[1]);
  return{canReuse,reason:canReuse?'脚本仅有排版变更，可确认修订并沿用原工程。':'脚本正文已变化，请确认脚本并核对素材规划；原工程仍保留。'};
 }catch{return{canReuse:false,reason:'脚本文件暂时无法核对，请检查素材文件后继续。'};}
}
export async function resumeWorkspaceScript(c:PoolClient,root:string,row:ProductionWorkspaceRecord,currentScript:string|null,stage:string,data:Record<string,unknown>){
 if(data.workspaceId!==row.id||data.expectedRevision!==Number(row.revision)||data.expectedScriptRevisionId!==currentScript||data.expectedProjectSha256!==row.project_sha256)throw new ConfigurationError(409,'脚本或工程版本已变化，请刷新后继续。');
 const recovery=await readWorkspaceScriptResume(c,root,row,currentScript,stage);
 if(!recovery?.canReuse)throw new ConfigurationError(409,recovery?.reason??'当前脚本不符合排版修订接续条件。');
 await verifyEpisodeFile(c,root,row.episode_id,row.project_path,row.project_sha256,Number(row.project_size));
 await verifyProductionPreparationSource(c,root,row.episode_id,row.preparation_revision_id??row.storyboard_package_id);
 const board=(await c.query("SELECT p.file_reference->>'relativePath' relative_path,p.file_reference->>'sha256' sha256,(p.file_reference->>'fileSize')::bigint file_size FROM local_identity.production_preparation_revisions p WHERE p.id=$1 AND p.episode_id=$2",[row.preparation_revision_id??row.storyboard_package_id,row.episode_id])).rows[0];
 if(!board)throw new ConfigurationError(409,'原工程制作依据不存在。');
 await verifyEpisodeFile(c,root,row.episode_id,board.relative_path,board.sha256,Number(board.file_size));
 if(row.storyboard_package_id){
  await c.query('SELECT local_identity.resume_workspace_formatting_revision($1,$2,$3,$4)',[row.id,Number(row.revision),currentScript,row.project_sha256]);
 }else{
  const manifest=(await c.query('SELECT manifest FROM local_identity.production_preparation_revisions WHERE id=$1 AND episode_id=$2',[row.preparation_revision_id,row.episode_id])).rows[0].manifest;
  const id=randomUUID(),location=await episodeStorageLocationAtRoot(c,root,row.episode_id),bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  const file={relativePath:`${location.relativePath}/preparation/${id}.json`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length},path=await safeAssetOutputPath(root,file.relativePath);
  await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});
  await verifyProductionPreparationDocument(c,root,row.episode_id,file,manifest);
  await c.query('SELECT local_identity.resume_production_formatting_revision($1,$2,$3,$4,$5,$6,$7)',[row.id,Number(row.revision),currentScript,row.project_sha256,id,file,manifest]);
 }
}
