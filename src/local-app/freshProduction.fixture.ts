import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {productionScriptTemplate} from '../reviews/productionScript';
import {nativeWorkspaceFixture,type FixtureSetupPoint} from './nativeWorkspace.fixture';
import {productionWorkspaceMigrations} from './productionWorkspace.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {inspectMediaRoot} from './mediaRootSettings';
import {fixtureResources} from './fixtureResources';

/** A new order starts from an empty workspace, never from a legacy Studio sample. */
export async function freshProductionFixture(options:{blank?:boolean;scriptText?:string;onSetup?:(point:FixtureSetupPoint)=>void|Promise<void>}={}){
 const resources=fixtureResources();
 try{
  const volume=await workspaceAudioVolume();resources.defer(volume.close);
  const checkpoint=(point:FixtureSetupPoint)=>options.onSetup?.({...point,mountPath:volume.mountPath});
  await checkpoint({stage:'volume'});
  const f=await nativeWorkspaceFixture({testRootParent:volume.mountPath,migrations:productionWorkspaceMigrations,onSetup:checkpoint,runtime:{mountPath:volume.mountPath,wake(){}}});
  resources.defer(f.close);
  const point={database:f.database,root:f.root};
  const binding=await inspectMediaRoot(f.root);
  await f.c.query('SELECT local_identity.bind_media_root($1,$2,$3,$4,false,$5)',[binding.path,binding.deviceId,binding.inodeId,binding.mountPath,f.owner]);
  const origin=await f.start();
  const account=await f.post('configuration','createAccount',{name:'新内容账号',slug:'fresh-'+randomUUID(),timezone:'Asia/Shanghai',policy:{positioning:'保留事实',tone:'克制'}});
  assert.equal(account.status,200,JSON.stringify(account.body));await checkpoint({stage:'account',...point,origin});
  const created=await f.post('episode-commands','create',{accountId:account.body.id,title:'正式新单'});
  assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.stage,'waiting_input');
  const newEpisode=created.body.id as string;
  await checkpoint({stage:'episode',...point,origin});
  const send=(command:string,data:Record<string,unknown>={})=>f.post('episode-commands',command,{episodeId:newEpisode,...data});
  let main:string|null=null;
  if(!options.blank){
   const imported=await send('importMaterial',{sourceKind:'file',sourcePath:'formal.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(options.scriptText??productionScriptTemplate).toString('base64')});
   assert.equal(imported.status,200,JSON.stringify(imported.body));main=imported.body.id;
   await checkpoint({stage:'script',...point,origin});
  }
  return{newEpisode,main,send,origin,token:f.token,c:f.c,root:f.root,database:f.database,close:resources.close};
 }catch(error){return resources.fail(error);}
}
