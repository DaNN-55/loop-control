// Legacy Studio sample, built on the shared real isolated workspace.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {reviewRenderFromSnapshot} from '../worker/codexRunner';
import {verifyOpenChatCutProject} from '../worker/openchatcutProjectReader';
import {buildOpenChatCutProject} from '../worker/openchatcutProject';
import {confirmedTtsRender} from '../worker/openchatcutProject.fixture';
import {inspectMediaRoot} from './mediaRootSettings';
import {nativeWorkspaceFixture,type NativeWorkspaceFixtureOptions} from './nativeWorkspace.fixture';
import {fixtureResources} from './fixtureResources';
const exec=promisify(execFile);
export async function embeddedStudioFixture(options:NativeWorkspaceFixtureOptions&{importRecord?:boolean;landscape?:boolean;episodeRelativePath?:(episodeId:string)=>string}={}){
 const resources=fixtureResources();
 try{
  const f=await nativeWorkspaceFixture(options);resources.defer(f.close);
  const {root,c,owner,runtime}=f,account=randomUUID(),episode=randomUUID(),task=randomUUID(),board=randomUUID(),qc=randomUUID(),boardArtifact=randomUUID(),videoArtifact=randomUUID();
  const assetRoot=join(root,'account'),episodeRelativePath=options.episodeRelativePath?.(episode)??`episodes/${episode}`;
  await mkdir(join(assetRoot,episodeRelativePath),{recursive:true});
    const render=confirmedTtsRender(false);render.preRenderReviewPackageId=board;render.adjustments.width=options.landscape?640:360;render.adjustments.height=options.landscape?360:640;render.adjustments.aspectRatio=options.landscape?'16:9':'9:16';
    const videoPath=`${episodeRelativePath}/shot.mp4`,voicePath=`${episodeRelativePath}/voice.mp3`,boardPath=`${episodeRelativePath}/board.json`;
    await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`testsrc2=size=${render.adjustments.width}x${render.adjustments.height}:rate=30`,'-t','2','-c:v','libx264','-pix_fmt','yuv420p',join(assetRoot,videoPath)]);
    await exec('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:a','libmp3lame',join(assetRoot,voicePath)]);
    render.projectRelativePath=boardPath;render.members[0].relativePath=videoPath;render.members[1].relativePath=voicePath;
    const files=[];
    for(const member of render.members){const bytes=await readFile(join(assetRoot,member.relativePath));member.sha256=createHash('sha256').update(bytes).digest('hex');files.push({relativePath:member.relativePath,sha256:member.sha256,fileSize:bytes.length,artifactType:member.memberKind});}
    await writeFile(join(assetRoot,boardPath),JSON.stringify(render.storyboard));const boardBytes=await readFile(join(assetRoot,boardPath)),boardSha=createHash('sha256').update(boardBytes).digest('hex');
    const snake=(v:unknown):unknown=>Array.isArray(v)?v.map(snake):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,value])=>[k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase()),k==='composition'?value:snake(value)])):v;
    const frozen=snake(render) as Record<string,unknown>;frozen.storyboard=render.storyboard;const parsed=reviewRenderFromSnapshot({capability:'review_rendering',review_render:frozen})!;await verifyOpenChatCutProject(parsed,buildOpenChatCutProject(parsed),runtime);
    await c.query('BEGIN');
    await c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Studio153 fixture','Asia/Shanghai')",[account,'studio153-'+account]);
    await c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[account,owner]);
    const directoryStat=await lstat(assetRoot,{bigint:true});await c.query('INSERT INTO local_identity.account_asset_directories(account_id,actual_root,device_id,inode_id) VALUES($1,$2,$3,$4)',[account,assetRoot,String(directoryStat.dev),String(directoryStat.ino)]);
    await c.query('INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,$2,true)',[account,{asset_root:assetRoot}]);
    await c.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[account]);
    await c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES($1,$2,$2,'隔离 Studio153 验收','qc_review')",[episode,account]);
    await c.query('INSERT INTO local_identity.input_episodes(episode_id,owner_id,storyboard_enabled) VALUES($1,$2,true)',[episode,owner]);
    await c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot) VALUES($1,$2,'generate_review_render','completed',$3)",[task,episode,{capability:'review_rendering',review_render:frozen,input_artifacts:files}]);
    await c.query("INSERT INTO public.artifacts(id,episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,$3,'storyboard',$4,$5,$6),($7,$2,$3,'render',$8,$9,$10)",[boardArtifact,episode,task,boardPath,boardSha,boardBytes.length,videoArtifact,videoPath,files[0].sha256,files[0].fileSize]);
    await c.query("INSERT INTO public.review_packages(id,episode_id,stage,revision_number,artifact_id,task_id,context_snapshot) VALUES($1,$2,'storyboard_review',1,$3,$4,$5),($6,$2,'qc_review',1,$7,$4,$8)",[board,episode,boardArtifact,task,{worker_result:{storyboard:render.storyboard}},qc,videoArtifact,{project_relative_path:boardPath}]);
    if(options.importRecord!==false)await c.query("INSERT INTO local_identity.import_record(imported_at,source_created_at,archive_sha256,source_media_root) VALUES(now(),now(),$1,$2)",['f'.repeat(64),root]);
    if(options.episodeRelativePath){const identity=await lstat(join(assetRoot,episodeRelativePath),{bigint:true});await c.query('INSERT INTO local_identity.episode_asset_locations(episode_id,account_id,asset_root,directory_relative_path,directory_device_id,directory_inode_id,layout_version) VALUES($1,$2,$3,$4,$5,$6,2) ON CONFLICT(episode_id) DO UPDATE SET directory_relative_path=excluded.directory_relative_path,directory_device_id=excluded.directory_device_id,directory_inode_id=excluded.directory_inode_id,layout_version=2',[episode,account,assetRoot,episodeRelativePath,String(identity.dev),String(identity.ino)]);}
    const rootBinding=await inspectMediaRoot(root);
    await c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[root,rootBinding.deviceId,rootBinding.inodeId,rootBinding.mountPath,owner]);
    await c.query('COMMIT');

  const origin=await f.start();
  const directory=await f.post('account-commands','setAssetDirectory',{accountId:account,path:assetRoot});
  if(directory.status!==200)throw Error('Fixture account directory: '+JSON.stringify(directory.body));
  const request=(command:string,data:Record<string,unknown>={},requestOptions:{token?:string;csrf?:boolean;origin?:string}={})=>f.post('episode-commands',command,{episodeId:episode,...data},requestOptions);
  return{...f,assetRoot,episodeRelativePath,episode,boardPath,board,task,videoPath,files,request,origin,closeStudio:()=>f.closeStudio(episode),close:resources.close};
 }catch(error){return resources.fail(error);}
}
