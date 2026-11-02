// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {serveDeliveryArchive} from './deliveryArchive';
it('streams a standard ZIP verified by an independent unzip implementation and fails closed on changed files',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-delivery-archive-'))),account=join(root,'account');await mkdir(account);
 const bytes=Buffer.alloc(1024*1024,73),json=Buffer.from('{"title":"测试"}');await writeFile(join(account,'video.mp4'),bytes);await writeFile(join(account,'metadata.json'),json);
 const entries=[['final-video.mp4','video.mp4',bytes],['metadata.json','metadata.json',json]].map(([name,path,b])=>({name:String(name),artifact:{relative_path:String(path),sha256:createHash('sha256').update(b).digest('hex'),file_size:b.length,source_asset_root:account,source_media_root:root}}));
 const server=createServer((_req,res)=>{void serveDeliveryArchive(root,entries,res,'episode').catch(()=>{if(res.headersSent)res.destroy();else{res.writeHead(409);res.end();}});});server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{
  const response=await fetch(url);expect(response.status).toBe(200);expect(response.headers.get('content-disposition')).toContain('attachment');const zip=join(root,'delivery.zip');await writeFile(zip,Buffer.from(await response.arrayBuffer()));expect((await readFile(zip)).length).toBe(Number(response.headers.get('content-length')));
  expect(execFileSync('unzip',['-t',zip],{encoding:'utf8'})).toContain('No errors');expect(execFileSync('unzip',['-p',zip,'metadata.json'])).toEqual(json);expect(execFileSync('unzip',['-p',zip,'final-video.mp4'],{maxBuffer:2*1024*1024})).toEqual(bytes);
  await writeFile(join(account,'metadata.json'),Buffer.alloc(json.length,1));expect((await fetch(url)).status).toBe(409);
  await rm(join(account,'metadata.json'));await symlink(join(account,'video.mp4'),join(account,'metadata.json'));expect((await fetch(url)).status).toBe(409);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
