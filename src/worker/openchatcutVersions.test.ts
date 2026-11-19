// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {checkpointOpenChatCutDraftVersion} from './openchatcutStudio';
import type {OpenChatCutProject} from './openchatcutProject';
import type {EpisodeFileIO} from '../local-app/episodeFiles';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-native-version-')));roots.push(root);
 const episode='version-order',projectId='loop-control-'+episode,dataDir=join(root,'episodes',episode,'openchatcut-work/current/runtime');
 await mkdir(join(root,'episodes',episode,'materials'),{recursive:true});
 await writeFile(join(root,'episodes',episode,'materials','old.png'),'verified-old-source');
 const project={version:3,activeTimelineId:'main',assets:[{id:'old',name:'old',kind:'image',src:`episodes/${episode}/materials/old.png`,durationInFrames:300}],mediaFolders:[],timelines:[{id:'main',name:'main',order:0,fit:'contain',captionsHidden:false,selectedId:null,fps:30,width:1080,height:1920,items:[{id:'piece-1',kind:'image',sourceAssetId:'old',src:`episodes/${episode}/materials/old.png`,track:'V1',startFrame:0,durationInFrames:90},{id:'piece-2',kind:'image',sourceAssetId:'old',src:`episodes/${episode}/materials/old.png`,track:'V1',startFrame:120,durationInFrames:60}],tracks:{V1:{kind:'video',name:'画面'}},trackOrder:['V1'],transitions:[]}]} as OpenChatCutProject;
 return{root,episode,projectId,dataDir,project};
}
it('stores a complete recoverable native version before the first editor launch',async()=>{
 const f=await fixture();await checkpointOpenChatCutDraftVersion(f.root,f.episode,f.project);
 const store=JSON.parse(await readFile(join(f.dataDir,'project-store-v1.json'),'utf8'));
 const versions=store.entries['versions:'+f.projectId];expect(versions).toHaveLength(1);
 expect(versions[0]).toMatchObject({name:'替换整条分镜前',automatic:false});
 expect(versions[0].doc.timelines[0].items.map((i:any)=>[i.id,i.startFrame,i.durationInFrames])).toEqual([['piece-1',0,90],['piece-2',120,60]]);
 const url=versions[0].doc.assets[0].src;expect(url).toMatch(/^\/media\/uploads\/[a-f0-9]+\.png$/);
 expect(await readFile(join(f.dataDir,url.slice(1)),'utf8')).toBe('verified-old-source');
 const metadata=JSON.parse(await readFile(join(f.dataDir,'../workspace.json'),'utf8'));expect(metadata.reverseSources[url]).toBe(f.project.assets[0].src);
});
it('appends to real SQLite history without altering the native current project or opaque versions',async()=>{
 const f=await fixture();await mkdir(f.dataDir,{recursive:true});
 const path=join(f.dataDir,'project-store-v1.sqlite3'),db=new DatabaseSync(path);db.exec('CREATE TABLE kv(k TEXT PRIMARY KEY,v TEXT NOT NULL)');
 db.prepare('INSERT INTO kv VALUES(?,?)').run('project:'+f.projectId,JSON.stringify(f.project));
 db.prepare('INSERT INTO kv VALUES(?,?)').run('versions:'+f.projectId,JSON.stringify([{future:'unknown-envelope'}]));db.close();
 await checkpointOpenChatCutDraftVersion(f.root,f.episode,f.project);
 const saved=new DatabaseSync(path,{readOnly:true});try{
  const current=saved.prepare('SELECT v FROM kv WHERE k=?').get('project:'+f.projectId) as {v:string};expect(JSON.parse(current.v)).toEqual(f.project);
  const raw=saved.prepare('SELECT v FROM kv WHERE k=?').get('versions:'+f.projectId) as {v:string};const history=JSON.parse(raw.v);expect(history).toHaveLength(2);expect(history[1]).toEqual({future:'unknown-envelope'});
 }finally{saved.close();}
});
it('fails before recording a version when its media is unavailable',async()=>{
 const f=await fixture();await rm(join(f.root,f.project.assets[0].src));
 await expect(checkpointOpenChatCutDraftVersion(f.root,f.episode,f.project)).rejects.toThrow();
 await expect(readFile(join(f.dataDir,'project-store-v1.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it('preserves an unused unavailable library entry without making it a new replacement prerequisite',async()=>{
 const f=await fixture();f.project.assets.push({id:'unused',name:'offline library',kind:'image',src:'unavailable-old-library.png',durationInFrames:30});
 const storage:EpisodeFileIO={relativePath:`episodes/${f.episode}`,assetRoot:f.root,assertValid:async()=>{},resolveReference:async path=>{if(path==='unavailable-old-library.png')throw Error('No current lineage for unused legacy media');return join(f.root,path);},assertFrozenDirectory:async()=>f.root,referencePrefixes:async()=>[],referenceAliases:async()=>[]};
 await checkpointOpenChatCutDraftVersion(f.root,f.episode,f.project,{},storage);
 const store=JSON.parse(await readFile(join(f.dataDir,'project-store-v1.json'),'utf8'));expect(store.entries['versions:'+f.projectId][0].doc.assets[1].src).toBe('unavailable-old-library.png');
});
