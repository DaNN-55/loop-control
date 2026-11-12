// Preserve the original paid outputs after the duplicate-reference invalidation bug.
// This copies files for normal UI import. It never rewrites task history or calls a provider.
import{Pool}from'pg';
import{readFile,readdir,copyFile,writeFile}from'node:fs/promises';
import{join}from'node:path';
import{createHash}from'node:crypto';
import{execFileSync}from'node:child_process';
const root=process.cwd(),d=JSON.parse(await readFile('.scratch/live-production/deployment.json','utf8'));
const pool=new Pool({...d.database,user:'postgres'});
const rows=(await pool.query("SELECT t.id,t.input_snapshot->'workspace_target'->>'shotId' shot,r.provider_task_id FROM public.tasks t JOIN public.paid_generation_reservations r ON r.task_id=t.id WHERE t.episode_id='830c0ab9-bf92-4ed5-9d71-23ebcc7264f4' AND t.task_type='generate_shot_video' AND t.status='failed' AND t.invalidated_reason='A newer revision replaced an upstream production material.' AND r.provider_task_id IS NOT NULL")).rows;await pool.end();
const files=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())await walk(path);else if(path.includes('/.native-worker-attempts/')&&path.endsWith('.mp4'))files.push(path);}}
await walk(d.mediaRoot);
const recovered=[];
for(const row of rows){
 const found=files.filter(path=>path.endsWith('/'+row.id+'/'+row.id+'.mp4'));if(found.length!==1)throw Error('Exactly one original staged output required');
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=width,height,codec_type','-of','json',found[0]],{encoding:'utf8'}));
 if(!probe.streams.some(s=>s.codec_type==='video')||!(Number(probe.format.duration)>0))throw Error('Invalid original video');
 const target=join(root,'.scratch/live-production',`日照金山-${row.shot}-原API结果.mp4`);
 await copyFile(found[0],target);const bytes=await readFile(target);
 recovered.push({taskId:row.id,providerTaskId:row.provider_task_id,shotId:row.shot,source:found[0],file:target,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,probe,recovery:'normal UI import of original bytes; historical task remains failed',newProviderPosts:0});
}
await writeFile('docs/verification/live-production-20261112/recovered-videos.json',JSON.stringify(recovered,null,2));console.log(JSON.stringify(recovered.map(({shotId,bytes,probe})=>({shotId,bytes,probe}))));
