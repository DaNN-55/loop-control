// @vitest-environment node
import{createServer}from'node:http';
import{once}from'node:events';
import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{createHash}from'node:crypto';
import{it,expect}from'vitest';
import{serveOwnedArtifact}from'./artifactRoute';
it('serves verified media byte ranges for seeking and rejects invalid ranges or tampered bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'t20-artifact-')),account=join(root,'account'),bytes=Buffer.from('verified-video-fixture');await mkdir(account);const path=join(account,'proxy.mp4');await writeFile(path,bytes);
 const artifact={relative_path:'proxy.mp4',sha256:createHash('sha256').update(bytes).digest('hex'),file_size:bytes.length,source_asset_root:account,source_media_root:root};
 const server=createServer((req,res)=>{void serveOwnedArtifact(root,artifact,res,req.headers.range).catch(()=>{res.writeHead(409);res.end();});});server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address()as{port:number}).port}`;
 try{
  const full=await fetch(url);expect(full.status).toBe(200);expect(full.headers.get('accept-ranges')).toBe('bytes');expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
  for(const[range,start,end]of[['bytes=2-7',2,7],['bytes=8-',8,bytes.length-1],['bytes=-4',bytes.length-4,bytes.length-1],['bytes=0-9999',0,bytes.length-1]]as const){const r=await fetch(url,{headers:{Range:range}});expect(r.status).toBe(206);expect(r.headers.get('content-range')).toBe(`bytes ${start}-${end}/${bytes.length}`);expect(Buffer.from(await r.arrayBuffer())).toEqual(bytes.subarray(start,end+1));}
  for(const range of ['bytes=999-','bytes=7-2','bytes=-0','bytes=-','bytes=0-1,3-4','items=0-1']){const r=await fetch(url,{headers:{Range:range}});expect(r.status).toBe(416);expect(r.headers.get('content-range')).toBe(`bytes */${bytes.length}`);await r.arrayBuffer();}
  await writeFile(path,Buffer.alloc(bytes.length,1));expect((await fetch(url,{headers:{Range:'bytes=0-1'}})).status).toBe(409);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
