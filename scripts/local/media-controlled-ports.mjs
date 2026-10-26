// T19 acceptance only: fabricated qualification metadata and synthetic secrets.
// URLs are parsed in memory; NEVER log request URLs/headers (Freesound has token).
import{readFileSync,existsSync,appendFileSync}from'node:fs';import{join}from'node:path';import{root}from'./environment.mjs';
const run=join(root,'state/t19-20261024');
export async function createNarrationPorts(){let secret='';return{mode:'controlled',store:{mode:'keychain',async putImmutable(){throw Error('Read only substitute');},async get(ref){secret='T19_ACCOUNT:T19_SYNTHETIC_'+ref;return secret;}},async fetcher(input,init){const u=new URL(String(input)),fault=existsSync(join(run,'fail-'+u.hostname));appendFileSync(join(run,'controlled-events.jsonl'),JSON.stringify({mode:'controlled',host:u.hostname,path:u.pathname.split('/').slice(0,3).join('/'),fault,onlineRequests:0})+'\n',{mode:0o600});await new Promise(r=>setTimeout(r,250));if(fault)return Response.json({message:secret},{status:500});
 if(u.hostname==='api.openai.com')return Response.json({data:[{b64_json:readFileSync(join(run,'reference.png')).toString('base64')}]});
 if(u.hostname==='api.cloudflare.com')return Response.json({result:{image:readFileSync(join(run,'reference.jpg')).toString('base64')}});
 if(u.hostname==='api.pexels.com'){if(new Headers(init?.headers).get('Authorization')!==secret)throw Error('Frozen secret mismatch');return Response.json({videos:[{id:19,duration:8,video_files:[{file_type:'video/mp4',width:360,height:640,link:'https://fixtures.invalid/video.mp4'}]}]});}
 if(u.hostname==='freesound.org'){if(u.searchParams.get('token')!==secret)throw Error('Frozen secret mismatch');return Response.json({results:[{id:19,name:'Synthetic tone',username:'Local fixture',license:'Synthetic acceptance only',duration:8,url:'https://fixtures.invalid/19',previews:{'preview-hq-mp3':'https://fixtures.invalid/tone.mp3'}}]});}
 if(u.hostname==='fixtures.invalid'&&u.pathname==='/video.mp4')return new Response(readFileSync(join(run,'source.mp4')),{headers:{'Content-Type':'video/mp4'}});
 if(u.hostname==='fixtures.invalid'&&u.pathname==='/tone.mp3')return new Response(readFileSync(join(run,'tone.mp3')),{headers:{'Content-Type':'audio/mpeg'}});
 throw Error('No external I/O allowed');}};}
