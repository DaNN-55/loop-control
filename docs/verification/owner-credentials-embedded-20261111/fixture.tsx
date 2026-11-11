import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ConnectionsSettingsDialog} from '../../../src/local-app/ConnectionsSettingsDialog';
import {LocalSecretAdministration} from '../../../src/local-app/LocalSecretAdministration';
import {WorkspaceDraftProvider} from '../../../src/local-app/WorkspaceDraft';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/maintenance.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/ui/impeccable/surface-polish.css';
import '../../../src/ui/impeccable/scroll-layout.css';

const reference='ab2b1e39-6db1-4b8b-8d86-e86e44a4c648';
let connection={id:'synthetic-connection',name:'图片制作',provider:'openai',adapter:'openai_images',current_version_id:'synthetic-version-1',status:'verified',endpoint:'https://api.example.invalid/v1',created_by:'fixture-owner',created_at:'',description:'',last_verified_at:null,last_verification_detail:null};
const details=()=>({reference,names:[connection.name],aliases:[],purpose:'当前连接：图片制作',category:'connection',runtimeUses:[],connections:[{connectionId:connection.id,name:connection.name,provider:'openai',version:connection.current_version_id.endsWith('2')?2:1,current:true,revoked:false}],pendingUses:[],history:{metadataOccurrences:0,fileOccurrences:0,files:[]},revealAllowed:true,state:'未读取密钥值'});
const evidence={requests:[] as Array<{method:string;path:string;command?:string}>,copies:[] as string[]};
Object.assign(window,{credentialEvidence:evidence});
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{evidence.copies.push(value);}}});
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.origin),path=url.pathname.replace('/api/local/',''),method=init?.method??'GET',body=method==='POST'?JSON.parse(String(init?.body)):undefined;
 evidence.requests.push({method,path,...(body?{command:body.command}: {})});
 if(url.origin!==location.origin||!url.pathname.startsWith('/api/local/'))return Response.json({error:'Fixture blocked'}, {status:404});
 if(path==='session')return Response.json({csrfToken:'fixture-only'});
 if(path==='connections'&&method==='POST'){
  if(body.command==='rotate')connection={...connection,current_version_id:'synthetic-version-2',status:'unverified'};
  if(body.command==='update')connection={...connection,...body.data};
  if(body.command==='verify')return Response.json({ready:false,detail:'合成验证未通过，凭据仍已保存。'});
  return Response.json({connection});
 }
 if(path==='connections')return Response.json({connections:[connection],versions:[],serviceCatalog:{groups:[{capability:'image',label:'图片',services:[{id:'images',connectionId:connection.id,provider:'openai',adapter:'openai_images',mode:'generation',connectionVersionId:connection.current_version_id,models:['gpt-image-2'],executable:true}]}]},capabilities:{secrets:'keychain',verification:'live',externalReady:true,verificationAvailable:true}});
 if(path==='secrets')return Response.json({items:[details()],total:1,page:1,pageSize:50});
 if(path==='secrets/detail')return Response.json({item:details()});
 if(path==='secrets/reveal')return body.password==='synthetic-password-only'?Response.json({value:'synthetic-credential-visible-only',expiresAt:new Date(Date.now()+30000).toISOString()}):Response.json({error:'当前密码验证失败。'},{status:403});
 return Response.json({error:'Fixture route unavailable'}, {status:404});
};
function Fixture(){
 const [page,setPage]=useState('connections'),[target,setTarget]=useState(''),[query,setQuery]=useState('');
 const close=()=>setPage('none');
 return <main className="impeccable-app dan-ui product-ui" style={{padding:16}}><div style={{display:'flex',gap:12,marginBottom:16}}><button onClick={()=>setPage('connections')}>连接页面</button><button onClick={()=>setPage('secrets')}>密钥页面</button><button onClick={()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';}}>切换主题</button></div><section role="dialog" aria-label="设置夹具" className="fixture-window">{page==='connections'?<ConnectionsSettingsDialog embedded initialConnectionId={target} onClose={close} returnFocusRef={{current:null}} onOpenSecrets={(_id,name)=>{setQuery(name??'');setPage('secrets');}}/>:page==='secrets'?<LocalSecretAdministration embedded csrf="fixture-only" initialQuery={query} onClose={close} onOpenConnection={id=>{setTarget(id);setPage('connections');}}/>:<p>设置已关闭</p>}</section></main>;
}
createRoot(document.getElementById('root')!).render(<WorkspaceDraftProvider><Fixture/></WorkspaceDraftProvider>);
