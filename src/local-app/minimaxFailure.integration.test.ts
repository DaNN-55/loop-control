// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {readFile} from 'node:fs/promises';
import {narrationFixture} from './workspaceNarration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {createWorkspaceGenerationFetcher} from './providerNetwork';
import {VideoGenerationError} from '../worker/videoGenerationError';
const seam=vi.hoisted(()=>({ports:undefined as any}));
vi.mock('./narrationWorker',async original=>{const actual=await original<typeof import('./narrationWorker')>();return{...actual,narrationPorts:async(...args:Parameters<typeof actual.narrationPorts>)=>seam.ports??actual.narrationPorts(...args)};});
afterEach(()=>{seam.ports=undefined;});
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled).each(['success','rejected','not_sent','unknown'] as const)('MiniMax reference request: actual Owner/Worker preserves $s outcome and duplicate guard',async fault=>{
 const f=await narrationFixture(undefined,undefined,{provider:'minimax',model:'MiniMax-H3'});
 try{
  await f.authorize();const events:string[]=[];
  const transport=async(input:string|URL,init:RequestInit={})=>{
   const url=new URL(input),method=init.method==='POST'?'POST':url.hostname==='api.minimax.io'?'poll':'download';events.push(method);
   if(method==='POST'){
    expect(JSON.parse(String(init.body)).content[1].role).toBe('reference_image');
    if(fault==='unknown')throw Object.assign(Error('connection reset'),{cause:{code:'ECONNRESET'}});
    if(fault==='rejected')return Response.json({type:'error',error:{type:'insufficient_balance_error',message:'insufficient balance (1008)',http_code:'402'},request_id:'minimax-request-1'},{status:402});
    return Response.json({task_id:'minimax-reference-task'});
   }
   if(method==='poll')return Response.json({task:{status:'succeeded',content:{url:'https://cdn.hailuoai.com/reference.mp4'}}});
   return new Response(await readFile(workspaceTestMedia('landscape-red-blue.mp4')),{headers:{'content-type':'video/mp4'}});
  };
  const fetcher=createWorkspaceGenerationFetcher('minimax',{reserve:async()=>{},videoTaskId:()=> 'minimax-reference-task'},transport);
  seam.ports={mode:'controlled',store:{mode:'keychain',get:async()=> 'synthetic-minimax-key'},fetcher:async(input:string|URL,init:RequestInit={})=>{
   if(fault==='not_sent'&&init.method==='POST')throw new VideoGenerationError('MiniMax 参考图请求被本机首帧校验拦截，未发送到供应商。','not_sent');
   return fetcher(input,init);
  }};
  const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'minimax-reference.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status).toBe(200);
  const initial=f.made,args={workspaceId:initial.id,expectedRevision:initial.revision,targetItemId:initial.clips[0].itemId,videoMode:'references',visualInputs:[{role:'referenceImages',materialRevisionId:image.body.id}],prompt:'按参考人物转头',durationSeconds:4,reservationCents:240};
  const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);const task=queued.body.visualTasks[0];
  await f.execute(task.taskId,false);const w=await f.read(),actual=w.visualTasks.find((t:any)=>t.taskId===task.taskId);
  if(fault==='success'){
   expect(actual).toMatchObject({status:'completed',submissionOutcome:'received',providerTaskId:'minimax-reference-task'});expect(w.visualCandidates).toHaveLength(1);expect(events).toEqual(['POST','poll','download']);
  }else{
   expect(w.visualCandidates).toHaveLength(0);
   if(fault==='unknown'){
    expect(actual).toMatchObject({status:'blocked',submissionUnknown:true});expect(events).toEqual(['POST']);
    expect((await f.chosenRequest('requestWorkspaceVisualCandidate',{...args,prompt:'不能重复提交'})).status).toBe(409);
   }else{
    expect(actual).toMatchObject({status:'failed',submissionUnknown:false,submissionOutcome:fault==='not_sent'?'not_sent':'rejected',error:expect.stringContaining(fault==='not_sent'?'未发送到供应商':'insufficient balance')});
    expect(actual.error).not.toContain('媒体执行或产物验证失败');expect(events).toEqual(fault==='not_sent'?[]:['POST']);
    expect((await f.chosenRequest('requestWorkspaceVisualCandidate',{...args,prompt:'核对后重新确认'})).status).toBe(200);
   }
  }
 }finally{await f.close();}
},120000);
