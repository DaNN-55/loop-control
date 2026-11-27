import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,rm,writeFile,stat,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {release,tmpdir} from 'node:os';
/** A private disposable filesystem exercises the production mountpoint guard unchanged. */
export async function workspaceAudioVolume(options:{mountPath?:string;size?:'256m'|'2g'}={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-t06-volume-'))),exec=promisify(execFile);let attached=false,mountRoot:string|undefined;const log:string[]=[];
 // On macOS 27 the legacy sparse image creation failed. RAW .img remains
 // visible to the runner's existing hdiutil inventory and cleanup.
 const useRaw=process.platform==='darwin'&&parseInt(release(),10)>=27;
 const image=join(root,useRaw?'media.img':'media.sparseimage');
 const createArgs=useRaw
  ?['image','create','blank','--format','RAW','--size',options.size??'256m','--volumeName','loop-t06-isolated','--fs','APFS',image]
  :['create','-quiet','-type','SPARSE','-size',options.size??'256m','-fs','APFS','-volname','loop-t06-isolated',image];
 try{if(!options.mountPath)mountRoot=await mkdtemp('/private/tmp/loop-t06-mount-');}catch(error){await rm(root,{recursive:true,force:true});throw error;}
 const mountPath=options.mountPath??join(mountRoot!,'mounted');
 async function close(){try{if(attached){const r=await exec('hdiutil',['detach',mountPath],{timeout:30000});log.push(r.stdout);attached=false;}}finally{const evidence=process.env.LOOP_T06_EVIDENCE_DIR;if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'isolated-volume-log.txt'),JSON.stringify({root,image,mountPath,log},null,2));}if(!attached){await rm(root,{recursive:true,force:true});if(mountRoot)await rm(mountRoot,{recursive:true,force:true});}}}
 try{await mkdir(mountPath);log.push((await exec(useRaw?'diskutil':'hdiutil',createArgs,{timeout:60000})).stdout);log.push((await exec('hdiutil',['attach','-nobrowse','-noautoopen','-mountpoint',mountPath,image],{timeout:60000})).stdout);attached=true;if((await stat(mountPath)).dev===(await stat(dirname(mountPath))).dev)throw Error('Isolated media image did not become a distinct mountpoint.');return{mountPath,close,unmount:async()=>{if(attached){log.push((await exec('hdiutil',['detach',mountPath],{timeout:30000})).stdout);attached=false;}},remount:async()=>{if(!attached){await mkdir(mountPath,{recursive:true});log.push((await exec('hdiutil',['attach','-nobrowse','-noautoopen','-mountpoint',mountPath,image],{timeout:60000})).stdout);attached=true;}}};}catch(e){await close();throw e;}
}
