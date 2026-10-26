// @vitest-environment node
import{it,expect}from'vitest';
import{mkdtemp,readFile,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{generateVisualAssets}from'./visualAssetExecutor';
import type{WorkerTaskPackage}from'./contracts';
it('writes native generated image artifacts into their task namespace while retaining the legacy default',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-visual-')),image=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]);
 try{
  const p={task:{id:'task'},episode:{id:'episode'},accountId:'account',assets:{allowedRoot:root},visualAssetPreparation:{imageGeneration:{provider:'openai',adapter:'openai_images',model:'gpt-image-1',credentialRef:'ref'}}} as WorkerTaskPackage;
  const response=JSON.stringify({status:'completed',artifacts:[],visualAssetRequests:[{id:'cover',prompt:'A controlled image'}]});
  const fetcher=async()=>new Response(JSON.stringify({data:[{b64_json:image.toString('base64')}]}),{status:200});
  const native=JSON.parse(await generateVisualAssets(p,response,async()=> 'controlled',fetcher,'episodes/episode/native-tasks/task/visuals'));
  expect(native.artifacts[0].relativePath).toBe('episodes/episode/native-tasks/task/visuals/cover.png');
  expect(await readFile(join(root,native.artifacts[0].relativePath))).toEqual(image);
  const legacy=JSON.parse(await generateVisualAssets(p,response,async()=> 'controlled',fetcher));
  expect(legacy.artifacts[0].relativePath).toBe('episodes/episode/visuals/cover.png');
 }finally{await rm(root,{recursive:true,force:true});}
});
