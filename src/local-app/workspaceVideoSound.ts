import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {episodeFileIO,verifyEpisodeFile} from './episodeFiles.js';
import {snapshotInput} from './localFiles.js';
import {extractMp3Artifact,probeVideoHasAudio} from '../worker/mediaTools.js';
import type {VideoSound} from '../workspaceVideoSound.js';

/** Copy only the adopted window into a registered, reusable audio material. */
export async function prepareWorkspaceVideoSound(
 c:PoolClient,root:string,episodeId:string,path:string,sourceSha:string,
 fps:number,startFrame:number,durationFrames:number,playbackRate=1,hasAudio?:boolean,
):Promise<VideoSound>{
 const io=await episodeFileIO(c,root,episodeId,true);
 const physical=await io.resolveReference(path);
 const start=startFrame/fps,duration=durationFrames*playbackRate/fps;
 const identity=createHash('sha256').update(JSON.stringify([sourceSha,start,duration])).digest('hex');
 const filename='视频原声-'+identity+'.mp3';
 const origin='derived-video-audio/'+filename;
 const registered=(await c.query(`SELECT id,storage_path,sha256,file_size FROM public.production_material_revisions
  WHERE episode_id=$1 AND source_path=$2 AND material_type='audio' LIMIT 1`,[episodeId,origin])).rows[0];
 const result=(id:string,src:string,sha256:string):VideoSound=>({
  mode:'separate',sha256,asset:{id:'material-'+id,src,name:'视频原声',kind:'audio',durationInFrames:Math.ceil(duration*fps)},
 });
 if(registered){
  await verifyEpisodeFile(c,root,episodeId,registered.storage_path,registered.sha256,Number(registered.file_size));
  return result(registered.id,registered.storage_path,registered.sha256);
 }
 if(hasAudio===false)return {mode:'silent'};
 let bytes:Uint8Array;
 try{
  if(hasAudio===undefined&&!await probeVideoHasAudio(physical))return {mode:'silent'};
  bytes=await extractMp3Artifact(physical,duration,start);
 }catch{
  return {mode:'embedded'};
 }
 await io.assertValid();
 const file=await snapshotInput(io.assetRoot,episodeId,{sourceKind:'file',sourcePath:filename,contentBase64:Buffer.from(bytes).toString('base64')},io.relativePath);
 await io.assertValid();
 const {id}=(await c.query(`SELECT (public.import_production_material($1,'audio','file',$2,$3,'audio/mpeg',$4,$5,false,'general_reference')).id`,
  [episodeId,origin,file.storagePath,file.sha256,file.fileSize])).rows[0];
 return result(id,file.storagePath,file.sha256);
}
