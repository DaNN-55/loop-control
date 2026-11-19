import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {createWorkspacePublishPackage,verifyWorkspaceManifest,type WorkspaceDeliveryIdentity} from './workspacePublishPackage';
import {verifyPublishPackage} from './publishPackage';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function core(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-core-package-')));roots.push(root);
 const episodeId='episode',prefix=`episodes/${episodeId}`;await mkdir(join(root,prefix),{recursive:true});
 async function file(artifactType:string,name:string,contents:string){const bytes=Buffer.from(contents);await writeFile(join(root,prefix,name),bytes);return{artifactType,relativePath:`${prefix}/${name}`,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length};}
 const video=await file('final_render','final.mp4','immutable-render'),project=await file('editable_project','project.json',JSON.stringify({version:3,activeTimelineId:'main',timelines:[{id:'main',items:[]}],assets:[]}));
 const identity:WorkspaceDeliveryIdentity={workspaceId:'workspace',exportId:'export',projectContentVersion:1,contentSha256:'a'.repeat(64),video,project};
 const report=await file('final_qc_report','checks.json',JSON.stringify({passed:true,exportId:identity.exportId,contentSha256:identity.contentSha256,checks:[{name:'file',passed:true}]}));
 return{root,episodeId,prefix,identity,artifacts:[video,project,report]};
}
it('completes a versioned core package without publication text or cover',async()=>{
 const f=await core();
 const pack=await createWorkspacePublishPackage({assetRoot:f.root,episodeId:f.episodeId,relativePath:`${f.prefix}/manifest.json`,identity:f.identity,artifacts:f.artifacts});
 const manifest=JSON.parse(await readFile(join(f.root,pack.relativePath),'utf8'));
 expect(manifest.version).toBe('publish-package/v3');expect(manifest.artifacts.map((a:{artifactType:string})=>a.artifactType)).toEqual(['final_render','editable_project','final_qc_report']);
 await expect(verifyPublishPackage({assetRoot:f.root,episodeId:f.episodeId,publishPackage:pack,expectedWorkspaceIdentity:f.identity})).resolves.toBeUndefined();
 await writeFile(join(f.root,f.identity.video.relativePath),'changed');
 await expect(verifyPublishPackage({assetRoot:f.root,episodeId:f.episodeId,publishPackage:pack})).rejects.toThrow();
});
it('does not reinterpret an incomplete v2 package as the new core format',async()=>{
 const f=await core();
 await expect(verifyWorkspaceManifest(f.root,f.episodeId,{version:'publish-package/v2',episodeId:f.episodeId,identity:f.identity,artifacts:f.artifacts})).rejects.toThrow('必需产物');
});
it('rejects missing core evidence and mismatched confirmed identity',async()=>{
 const f=await core(),manifest={version:'publish-package/v3',episodeId:f.episodeId,identity:f.identity,artifacts:f.artifacts};
 await expect(verifyWorkspaceManifest(f.root,f.episodeId,{...manifest,artifacts:f.artifacts.slice(0,2)})).rejects.toThrow('必需产物');
 await expect(verifyWorkspaceManifest(f.root,f.episodeId,manifest,{...f.identity,exportId:'other'})).rejects.toThrow('身份');
});
