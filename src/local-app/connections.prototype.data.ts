// All requests stay in this browser tab. Never enter real API keys in the demo.
import {buildProductionServiceCatalog} from '../connections/serviceCatalog';
import {registeredConnectionModels,modelDiscoveryAvailability} from '../connections/connectionModels';
import {billingProvider} from '../connections/connectionBilling';
import {connectionUsagePlaceholder} from '../connections/connectionUsage';
import type {ExternalConnection,ExternalConnectionVersion} from '../connections/ConnectionWorkspace';

const now='2026-11-03T09:30:00+08:00';
const fixtures=[
 ['gpt-image2','openai','openai_images'],['seedance','volcengine','seedance_video'],
 ['minimax','minimax','minimax_video'],['kling','kling','kling_video'],
 ['百炼-万象','bailian','wan_video'],['Pexels 素材连接','pexels','pexels_video'],
 ['火山语音连接','volcengine_tts','volcengine_tts'],['Freesound 音效库','freesound','freesound_preview'],
];
const usage={currentBlueprints:1,episodes:2,tasks:3,activeTasks:0,requests:1,savedSelections:1};
let connections:ExternalConnection[]=[];
let versions:ExternalConnectionVersion[]=[];
function add(name:string,provider:string,adapter:string,status:ExternalConnection['status']='verified'){
 const id=crypto.randomUUID();
 const c:ExternalConnection={id,name,provider,adapter,status,created_at:now,created_by:'demo',current_version_id:'',last_verification_detail:status==='retryable'?'演示：上次连接超时。':null,description:'演示连接 · 用于预览布局',last_verified_at:status==='verified'?now:null,usage};
 connections=[...connections,c];rotate(c,status);return c;
}
function rotate(c:ExternalConnection,status:ExternalConnection['status']='unverified'){
 const old=versions.filter(v=>v.connection_id===c.id);
 old.forEach(v=>{v.is_current=false;});
 const id=crypto.randomUUID();
 versions=[...versions,{id,connection_id:c.id,provider:c.provider,adapter:c.adapter,version:old.length+1,created_at:now,endpoint:'https://example.invalid',status,is_current:true,revoked_at:null,secretState:'bound-unchecked',usage}];
 Object.assign(c,{current_version_id:id,status});
}
fixtures.forEach(([name,provider,adapter],i)=>add(name,provider,adapter,i===7?'retryable':'verified'));
const historical=versions[0];historical.secretState='unbound';rotate(connections[0],'verified');
const harnesses=[1,2].map(version=>({id:'harness-'+version,account_id:'demo',capability:'storyboard_planning',version,name:version===1?'分镜规划 v1':'测试',slug:'storyboard-planning-v'+version,summary:'按原文顺序拆解镜头',instructions:'保留脚本中的镜头顺序。',content_hash:'a'.repeat(64),is_active:true,created_at:now,created_by:'demo'}));
const globalHarnesses=harnesses.map(version=>({...version,account_id:'prototype-global'}));
const episodes=[{id:'d47aba50-demo',title:'测试',stage:'script_confirmed'},...Array.from({length:12},(_,i)=>({id:'demo-shot-'+(i+1),title:i===0?'末班车前的一把伞 · MiniMax':'示例生产单 '+(i+1),stage:'script_confirmed'}))];
const plans=new Map();
let globalPlan={revision:0,selection:null};
const billing=new Map();
const modelSettings=new Map<string,string[]>();
let cleanups=[{cleanupKey:'sample-restore',title:'测试生产单 · 删除未提交',phase:'prepared',stagingPath:'/demo/.staging/story-a'},{cleanupKey:'sample-retry',title:'测试生产单 · 文件待清理',phase:'committed',stagingPath:'/demo/.staging/story-b'}];
const realFetch=window.fetch.bind(window);
window.fetch=async (input,init)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
 if(url.origin!==location.origin)return Response.json({error:'演示已阻止外部请求。'},{status:403});
 if(!url.pathname.startsWith('/api/local/'))return realFetch(input,init);
 const path=url.pathname.slice('/api/local/'.length);
 const {command,data={}}=init?.body?JSON.parse(String(init.body)):{};
 const id=data.connectionId??url.searchParams.get('connectionId');
 const c=connections.find(c=>c.id===id);
 const v=versions.find(v=>v.id===data.versionId);
 const json=Response.json;
 if(path==='session')return json({csrfToken:'prototype-only'});
 if(path==='catalog'){
   const list=episodes.filter(e=>(e.title+' '+e.id).includes(url.searchParams.get('q')??''));
   const page=Number(url.searchParams.get('page')??1),pageSize=8;
   return json({episodes:list.slice((page-1)*pageSize,page*pageSize),page,pageSize,total:list.length});
 }
 if(/^episodes\/[^/]+\/workspace$/.test(path)){
   const plan=plans.get(path.split('/')[1]);
   return json({planningSelection:{accountId:'demo',revision:plan?.revision??0,selection:plan?.selection??null,promptVersions:harnesses}});
 }
 if(command==='saveWorkspacePlanningSelection'){
   plans.set(data.episodeId,{selection:data.selection,revision:data.expectedSelectionRevision+1});return json({ok:true});
 }
 if(path==='prototype-global-planning'){
   if(command==='saveGlobalPlanningDefaults'){
     if(data.expectedSelectionRevision!==globalPlan.revision)return json({error:'全局设置已更新，请重新打开。'},{status:409});
     globalPlan={revision:globalPlan.revision+1,selection:data.selection};
   }
   if(command!=='createGlobalPromptVersion')return json({planningSelection:{...globalPlan,promptVersions:globalHarnesses}});
 }
 if(command==='createPromptVersion'||path==='prototype-global-planning'&&command==='createGlobalPromptVersion'){
   const versions=command==='createGlobalPromptVersion'?globalHarnesses:harnesses;
   const version=versions.length+1;
   const h={...versions[0],name:data.name,slug:data.slug??'storyboard-planning-v'+version,summary:data.summary,instructions:data.instructions,id:'harness-'+version,version};versions.push(h);return json(h);
 }
 if(path==='deletion-cleanups')return json(cleanups);
 if(command==='retryDeletionCleanup'){
   cleanups=cleanups.filter(item=>item.cleanupKey!==data.deletionKey);return json({cleanupPending:false,recovered:data.deletionKey==='sample-restore'});
 }
 const sampleUsage=(provider:string)=>({...connectionUsagePlaceholder(provider),updatedAt:now});
 if(path==='connection-usage'&&c)return json({versionId:c.current_version_id,usage:sampleUsage(c.provider)});
 if(path==='connection-billing'&&c){
   if(command==='save'||command==='disconnect')billing.set(id,command==='save');
   return json({connectionId:id,provider:billingProvider(c.provider),configured:billing.get(id)??c.provider==='openai',revision:'demo',updatedAt:now,usage:sampleUsage(c.provider)});
 }
 if(path==='connection-models'&&c){
   const models=registeredConnectionModels(c.provider,c.adapter);
   if(command==='save')modelSettings.set(id,data.enabledModels);
   return json({connectionId:id,versionId:c.current_version_id,revision:'demo',enabledModels:modelSettings.get(id)??models.map(m=>m.id),models,discovery:modelDiscoveryAvailability(c.provider)});
 }
 if(path==='connections'){
   if(command==='create')return json({connection:add(data.name,data.provider,data.adapter,'unverified')});
   if(command==='verify'&&c){
     c.status='verified';c.last_verified_at=now;const current=versions.find(v=>v.id===c.current_version_id);if(current)current.status='verified';
     return json({connection:c,ready:true,detail:'演示验证通过'});
   }
   if(c&&['rotate','region','update'].includes(command)){
     if(command!=='update')rotate(c);
     for(const field of ['name','description','region'] as const)if(data[field]!==undefined)Object.assign(c,{[field]:data[field]});
     return json({connection:c});
   }
   if(command==='rebind'&&v){v.secretState='bound-unchecked';return json({rebound:true});}
   if(command==='revoke'&&v){v.revoked_at=now;v.status='revoked';return json({revoked:true});}
   if(!command)return json({connections,versions,serviceCatalog:buildProductionServiceCatalog({connections:connections.map(c=>({...c,current_version_id:c.current_version_id??null})),versions,externalReady:true,enabledModels:Object.fromEntries(modelSettings)}),capabilities:{billing:true,secrets:'keychain',verification:'demo',externalReady:true,verificationAvailable:true}});
 }
 return json({error:'此操作在演示中不可用。'},{status:400});
};
