// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import type {IncomingMessage} from 'node:http';
import {authorizeHarnessProduction} from './harnessProductionPolicy';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const scope={owner:{id,email:'test@example.invalid'},episodeIds:[id]};
const request=(url:string,method='GET')=>({url,method,headers:{host:'loop-control.internal'}} as IncomingMessage);
describe('Harness production capability',()=>{
 it('reads only allowed native pages in episode scope',async()=>{
  await expect(authorizeHarnessProduction(scope,request('/api/local/episodes/'+id),async()=>({}))).resolves.toBeUndefined();
  for(const url of ['/api/local/episodes/'+other,'/api/local/secrets','/api/local/../secrets','/api/local/catalog?view=accounts'])await expect(authorizeHarnessProduction(scope,request(url),async()=>({}))).rejects.toMatchObject({status:403});
 });
 it('denies generation, configuration and cross-episode mutations',async()=>{
  const operation=(command:string,episodeId=id)=>({command,data:{episodeId},idempotencyKey:id});
  for(const body of [operation('generateWorkspaceVisuals'),operation('create'),operation('exportWorkspace',other)])await expect(authorizeHarnessProduction(scope,request('/api/local/episode-commands','POST'),async()=>body)).rejects.toMatchObject({status:403});
  const body=operation('prepareWorkspace');await expect(authorizeHarnessProduction(scope,request('/api/local/episode-commands','POST'),async()=>body)).resolves.toEqual(body);
 });
 describe('local single-order creation and script editing',()=>{
  const unrestricted={owner:scope.owner};
  const operation=(command:string,data:Record<string,unknown>)=>({command,data,idempotencyKey:id});
  const authorize=(body:Record<string,unknown>,restricted=false)=>authorizeHarnessProduction(restricted?scope:unrestricted,request('/api/local/episode-commands','POST'),async()=>body);
  const receipt=(body:Record<string,unknown>)=>({endpoint:'episode-commands',operation:body});

  it('allows create without episodeId, leaving actual account ownership to the original command',async()=>{
   // A well-formed UUID is not evidence of account ownership: DB-backed
   // createEpisodeDirectory/sessionTransaction must still authorize it.
   const body=operation('create',{accountId:other,title:'本地制作',seriesVersionId:null,isTest:false});
   await expect(authorize(body)).resolves.toEqual(body);
   const read=vi.fn(async()=>receipt(body));
   await expect(authorizeHarnessProduction(unrestricted,request('/api/local/command-receipt','POST'),read)).resolves.toEqual(receipt(body));
  });
  it('refuses create in any explicitly restricted episode scope, including an empty list',async()=>{
   const body=operation('create',{accountId:other,title:'不能扩大范围'});
   for(const episodeIds of [[id],[]]){
    const restricted={owner:scope.owner,episodeIds};
    for(const [path,payload] of [['/api/local/episode-commands',body],['/api/local/command-receipt',receipt(body)]] as const){
     await expect(authorizeHarnessProduction(restricted,request(path,'POST'),async()=>payload)).rejects.toMatchObject({status:403});
    }
   }
  });
  it.each([undefined,null,'','not-an-account',id+'/../account'])('refuses create with malformed account identity %s',async accountId=>{
   await expect(authorize(operation('create',{accountId}))).rejects.toMatchObject({status:403});
  });
  it.each(['saveScriptReviewDraft','confirmScriptStudio'])('allows local %s with existing UI fields and applies episode scope',async command=>{
   const body=operation(command,{episodeId:id,text:'本地原文',targetDuration:null,reason:'修改说明',...(command==='confirmScriptStudio'?{expectedScriptRevisionId:null,importedVersion:other}:{})});
   await expect(authorize(body,true)).resolves.toEqual(body);
   await expect(authorize(operation(command,{...body.data,episodeId:other}),true)).rejects.toMatchObject({status:403});
   await expect(authorize(operation(command,{text:'缺少生产单'}))).rejects.toMatchObject({status:403});
  });
  it.each(['saveScriptReviewDraft','confirmScriptStudio'])('denies assistant receipt identities for %s and its receipt lookup',async command=>{
   for(const requestId of [other,null,'',undefined]){
    const body=operation(command,{episodeId:id,text:'不能采用助手回执',targetDuration:null,reason:'',requestId});
    await expect(authorize(body)).rejects.toMatchObject({status:403});
    await expect(authorizeHarnessProduction(unrestricted,request('/api/local/command-receipt','POST'),async()=>receipt(body))).rejects.toMatchObject({status:403});
   }
  });
  it.each(['saveScriptReviewDraft','confirmScriptStudio'])('budgets 128 KiB for full-length Chinese local %s and receipt payloads',async command=>{
   const body=operation(command,{episodeId:id,text:'汉'.repeat(20000),targetDuration:null,reason:'改'.repeat(4000),...(command==='confirmScriptStudio'?{expectedScriptRevisionId:null}:{})});
   for(const [path,payload] of [['/api/local/episode-commands',body],['/api/local/command-receipt',receipt(body)]] as const){
    const json=JSON.stringify(payload),bytes=Buffer.byteLength(json);
    expect(bytes).toBeGreaterThan(32*1024);expect(bytes).toBeLessThan(128*1024);
    const read=vi.fn(async(limit:number)=>{if(bytes>limit)throw Error('too large');return JSON.parse(json);});
    await expect(authorizeHarnessProduction(unrestricted,request(path,'POST'),read)).resolves.toEqual(payload);
    expect(read).toHaveBeenCalledExactlyOnceWith(128*1024);
   }
  });
  it('rejects requests beyond the native text budget without enlarging it for receipt lookups',async()=>{
   const body=operation('saveScriptReviewDraft',{episodeId:id,text:'汉'.repeat(45000),targetDuration:null,reason:''});
   for(const [path,payload] of [['/api/local/episode-commands',body],['/api/local/command-receipt',receipt(body)]] as const){
    const json=JSON.stringify(payload),read=vi.fn(async(limit:number)=>{if(Buffer.byteLength(json)>limit)throw Error('too large');return JSON.parse(json);});
    await expect(authorizeHarnessProduction(unrestricted,request(path,'POST'),read)).rejects.toMatchObject({status:400});
    expect(read).toHaveBeenCalledExactlyOnceWith(128*1024);
   }
  });
  it('keeps material uploads, structure edits, paid, batch and handoff capabilities outside this first slice',async()=>{
   for(const command of ['importMaterial','editWorkspaceStructure','saveWorkspaceVideoRanges','generateWorkspaceImage','requestWorkspaceVisualCandidate','confirmStoryboardBatch','createFromHandoff']){
    await expect(authorize(operation(command,{episodeId:id}))).rejects.toMatchObject({status:403});
   }
   for(const path of ['/api/local/episode-imports','/api/local/episode-batches','/api/local/harness-handoffs','/api/local/script-studio/requests']){
    await expect(authorizeHarnessProduction(unrestricted,request(path,'POST'),async()=>({}))).rejects.toMatchObject({status:403});
   }
  });
 });
});
