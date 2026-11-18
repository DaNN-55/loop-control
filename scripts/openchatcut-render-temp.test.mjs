// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,open,readFile,readdir,realpath,rm,symlink,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRenderTemp,pruneRenderTemps} from './openchatcut-render-temp.mjs';
const roots=[];
async function parent(){const root=await realpath(await mkdtemp(join(tmpdir(),'loop-temp-guard-')));roots.push(root);return root;}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function stale(root,name,pids=[2147483647]){
 const directory=join(root,name);await mkdir(directory,{mode:0o700});
 const marker=join(directory,'.render-owner.json');await writeFile(marker,JSON.stringify({version:1,pids}));await utimes(marker,1,1);return directory;
}
it('cleans a task and its nested generated bundle while leaving linked original media untouched',async()=>{
 const root=await parent(),media=join(root,'original.mp4');await writeFile(media,'immutable media');
 const task=await createRenderTemp(root);await mkdir(join(task.directory,'remotion-webpack-bundle-test'));await symlink(media,join(task.directory,'uploads'));
 expect(JSON.parse(await readFile(join(task.directory,'.render-owner.json'),'utf8')).pids).toContain(process.pid);
 await task.cleanup();await task.cleanup();expect(await readFile(media,'utf8')).toBe('immutable media');expect(await readdir(root)).toEqual(['original.mp4']);
});
it('reclaims a dead marked task but preserves live owners, live children, unmarked data and directory aliases',async()=>{
 const root=await parent();await stale(root,'loop-control-render-dead01');
 await stale(root,'loop-control-render-live01',[process.pid]);await stale(root,'loop-control-render-child1',[2147483647,process.pid]);
 const original=join(root,'unmarked');await mkdir(original);await symlink(original,join(root,'loop-control-render-alias1'));await mkdir(join(root,'remotion-webpack-bundle-legacy'));
 const removed=await pruneRenderTemps(root);expect(removed).toEqual([join(root,'loop-control-render-dead01')]);
 expect((await readdir(root)).sort()).toEqual(['loop-control-render-alias1','loop-control-render-child1','loop-control-render-live01','remotion-webpack-bundle-legacy','unmarked']);
});
it('preserves a newly created dead marker and records a child before it can be considered idle',async()=>{
 const root=await parent(),task=await createRenderTemp(root);await task.track(process.pid);await task.track(2147483647);
 expect(JSON.parse(await readFile(join(task.directory,'.render-owner.json'),'utf8')).pids).toEqual([process.pid,2147483647]);
 const fresh=await stale(root,'loop-control-render-fresh1');await utimes(join(fresh,'.render-owner.json'),new Date(),new Date());expect(await pruneRenderTemps(root)).toEqual([]);await task.cleanup();
});
it('waits for open files even after a recorded owner has exited',async()=>{
 const root=await parent(),directory=await stale(root,'loop-control-render-open01');
 const file=await open(join(directory,'in-progress'),'w');
 try{expect(await pruneRenderTemps(root)).toEqual([]);}finally{await file.close();}
 expect(await pruneRenderTemps(root)).toEqual([directory]);
});
