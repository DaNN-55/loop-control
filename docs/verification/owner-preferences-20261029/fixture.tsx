// Real application components; every HTTP call is intercepted. No real writes or providers.
import {createRoot} from 'react-dom/client';
import {LocalCatalogApp} from '../../../src/local-app/LocalCatalogApp';
import {defaultOwnerPreferences} from '../../../src/preferences/preferences';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/scroll-layout.css';
const id='10000000-0000-4000-8000-000000000001',at='2026-10-29T00:00:00Z';
const account={id,name:'隔离演示账号',slug:'demo',timezone:'Asia/Shanghai',created_at:at,archived_at:null,current_blueprint_version_id:id};
const data={accounts:[account],blueprints:[{id,account_id:id,version:1,policy:{positioning:'面向新用户，演示产品的日常使用。',asset_root:'/fixture/media/demo/'},is_active:true,is_snapshot:false,created_at:at,archived_at:null}],blueprintRevisions:{[id]:'a'.repeat(32)},episodes:[],series:[],seriesVersions:[],promptVersions:[],sourceCreatedAt:at,importedAt:at,page:1,pageSize:20,total:0,episodeCount:0,accountCounts:{[id]:0},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[]};
const query=new URLSearchParams(location.search);
let preferences=JSON.parse(sessionStorage.getItem('fixture.owner.preferences')??JSON.stringify({...defaultOwnerPreferences,displayName:'Dan',appearance:query.get('theme')==='dark'?'dark':'light'}));
window.fetch=async(input,init)=>{
 const url=String(input);
 if(url.endsWith('/session'))return Response.json({csrfToken:'fixture-only',owner:{id,email:'demo@example.invalid'}});
 if(url.endsWith('/preferences')){
  if(init?.method==='POST'){
   if(query.has('save-error'))return Response.json({error:'隔离验收：保存失败，请重试。'},{status:503});
   preferences=JSON.parse(String(init.body)).data;sessionStorage.setItem('fixture.owner.preferences',JSON.stringify(preferences));
  }
  return Response.json(preferences);
 }
 if(url.includes('/catalog?'))return Response.json(data);
 if(url.endsWith('/connections'))return Response.json({connections:[],versions:[]});
 if(url.endsWith('/notification-events'))return Response.json([]);
 if(url.endsWith('/system-status'))return Response.json({observedAt:at,automation:{stopped:false,lastError:null,lastScanAt:at,timezone:'Asia/Shanghai',hour:9,n8nRequired:false,backupsEnabled:false},plans:[],jobs:[],operations:{}});
 throw Error('隔离验收禁止真实请求：'+url);
};
createRoot(document.getElementById('root')!).render(<LocalCatalogApp/>);
