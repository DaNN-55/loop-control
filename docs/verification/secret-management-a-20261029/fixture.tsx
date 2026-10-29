// Real application components; every HTTP call is intercepted. No real writes or providers.
import {createRoot} from 'react-dom/client';
import {LocalCatalogApp} from '../../../src/local-app/LocalCatalogApp';
import {defaultOwnerPreferences} from '../../../src/preferences/preferences';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/maintenance.css';
import '../../../src/ui/impeccable/scroll-layout.css';
const id='10000000-0000-4000-8000-000000000001',at='2026-10-29T00:00:00Z';
const account={id,name:'隔离演示账号',slug:'demo',timezone:'Asia/Shanghai',created_at:at,archived_at:null,current_blueprint_version_id:id};
const data={accounts:[account],blueprints:[{id,account_id:id,version:1,policy:{positioning:'面向新用户，演示产品的日常使用。',asset_root:'/fixture/media/demo/'},is_active:true,is_snapshot:false,created_at:at,archived_at:null}],blueprintRevisions:{[id]:'a'.repeat(32)},episodes:[],series:[],seriesVersions:[],promptVersions:[],sourceCreatedAt:at,importedAt:at,page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{[id]:0},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[]};
const query=new URLSearchParams(location.search);
let preferences=JSON.parse(sessionStorage.getItem('fixture.owner.preferences')??JSON.stringify({...defaultOwnerPreferences,displayName:'Dan',appearance:query.get('theme')==='dark'?'dark':'light'}));
const rows=Array.from({length:27},(_,i)=>({reference:'10000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),names:[i<3?'百炼-万象':i===3?'Pexels 素材':i===4?'火山语音':i===5?'Freesound 音效':i===6?'应用数据库':i===7?'历史会话令牌':i===8?'未引用条目':`演示连接 ${i+1}`],aliases:i===1?['demo-legacy-reference']:[],category:i===6?'system':i===7?'history':i===8?'unreferenced':'connection',purpose:i===6?'主程序数据库运行凭据':i===7?'用于历史原文还原':i===8?'当前核查未发现引用':i===1||i===2?'连接历史版本':i<3?'当前连接：百炼-万象':'当前连接：演示服务',runtimeUses:i===6?['应用数据库']:[],connections:i===6||i===7||i===8?[]:[{connectionId:'demo-connection-'+i,name:i<3?'百炼-万象':'演示服务',provider:i<3?'bailian':'pexels',version:i<3?3-i:1,current:i!==1&&i!==2,revoked:i===2}],pendingUses:[],history:{metadataOccurrences:i===7?2:0,fileOccurrences:i===7?1:0,files:i===7?['合成资料 / account.txt']:[]},revealAllowed:i!==6,state:i===6?'仅展示用途':'未读取密钥值'}));
let listReads=0,detailReads=0;
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(){/* Test only: never replace the system clipboard. */}}});
window.fetch=async(input,init)=>{
 const url=String(input);
 if(url.endsWith('/session'))return Response.json({csrfToken:'fixture-only',secretAdministration:true,owner:{id,email:'demo@example.invalid'}});
 if(url.endsWith('/preferences')){
  if(init?.method==='POST'){
   if(query.has('save-error'))return Response.json({error:'隔离验收：保存失败，请重试。'},{status:503});
   preferences=JSON.parse(String(init.body)).data;sessionStorage.setItem('fixture.owner.preferences',JSON.stringify(preferences));
  }
  return Response.json(preferences);
 }
 if(url.includes('/secrets?')){
  if(query.has('loading'))await new Promise(resolve=>setTimeout(resolve,8000));
  if(query.has('list-error')&&listReads++===0)return Response.json({error:'合成列表暂时不可用'},{status:503});
  const params=new URL(url,location.href).searchParams,q=(params.get('q')??'').toLowerCase(),category=params.get('category'),filtered=rows.filter(row=>(category==='all'||category===row.category)&&JSON.stringify(row).toLowerCase().includes(q)),page=Number(params.get('page')??1);
  return Response.json({items:filtered.slice((page-1)*10,page*10),total:filtered.length,page,pageSize:10,observedAt:at});
 }
 if(url.includes('/secrets/detail?')){
  if(query.has('detail-error')&&detailReads++===0)return Response.json({error:'合成详情暂时不可用'},{status:503});
  const reference=new URL(url,location.href).searchParams.get('reference');return Response.json({item:rows.find(row=>row.reference===reference)});
 }
 if(url.endsWith('/secrets/reveal')){
  const body=JSON.parse(String(init?.body));
  if(body.password!=='SyntheticPassword-Only-2026')return Response.json({error:'合成密码验证失败'},{status:403});
  if(!rows.find(row=>row.reference===body.reference)?.revealAllowed)return Response.json({error:'此合成系统条目不可读取'},{status:403});
  return Response.json({value:'synthetic-not-a-real-key',expiresAt:new Date(Date.now()+(query.has('expired')?-1000:30000)).toISOString()});
 }
 if(url.includes('/catalog?'))return Response.json(data);
 if(url.endsWith('/connections'))return Response.json({connections:[],versions:[]});
 if(url.endsWith('/notification-events'))return Response.json([]);
 if(url.endsWith('/system-status'))return Response.json({observedAt:at,automation:{stopped:false,lastError:null,lastScanAt:at,timezone:'Asia/Shanghai',hour:9,n8nRequired:false,backupsEnabled:false},plans:[],jobs:[],operations:{}});
 throw Error('隔离验收禁止真实请求：'+url);
};
createRoot(document.getElementById('root')!).render(<LocalCatalogApp/>);
