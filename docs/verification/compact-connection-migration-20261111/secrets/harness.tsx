// Acceptance harness only: actual production components, synthetic fetch transport.
import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LocalSecretAdministration} from '../../../../src/local-app/LocalSecretAdministration';
import {OwnerSettingsDialog} from '../../../../src/local-app/OwnerSettingsDialog';
import {setUiLocale} from '../../../../src/i18n/ui';
import {englishMessages} from '../../../../src/i18n/en';
import {compactSecrets} from '../../../../src/i18n/en/compactSecrets';
import '../../../../src/styles.css';
import '../../../../src/ui/impeccable/foundation.css';
import '../../../../src/ui/impeccable/configuration.css';
import '../../../../src/ui/impeccable/maintenance.css';
import '../../../../src/ui/impeccable/production.css';
import '../../../../src/ui/impeccable/scroll-layout.css';
import '../../../../src/ui/impeccable/surface-polish.css';
import '../../../../src/ui/impeccable/detail-refinement.css';
import '../../../../src/ui/impeccable/interaction-refinement.css';
Object.assign(englishMessages,compactSecrets);
const params=new URLSearchParams(location.search);setUiLocale(params.get('lang')==='en'?'en-US':'zh-CN');document.documentElement.dataset.theme=params.get('theme')==='dark'?'dark':'light';document.documentElement.dataset.interface='impeccable';
const base={aliases:['synthetic-legacy-reference'],runtimeUses:[],pendingUses:['Synthetic pending operation'],history:{metadataOccurrences:1,fileOccurrences:2,files:['/synthetic/metadata-only.json']},revealAllowed:true,state:'未读取密钥值'};
const items=[{...base,reference:'00000000-0000-4000-8000-000000000001',names:['gpt-image2'],purpose:'当前连接：gpt-image2',category:'connection',connections:[{connectionId:'synthetic-connection',name:'gpt-image2',provider:'OpenAI',version:2,current:true,revoked:false}]},{...base,reference:'00000000-0000-4000-8000-000000000002',names:['VeryLongUnbreakableSyntheticConnectionName'.repeat(7)],purpose:'Synthetic history usage '.repeat(5),category:'history',connections:[{connectionId:'synthetic-connection',name:'gpt-image2',provider:'OpenAI',version:1,current:false,revoked:true}]},{...base,reference:'00000000-0000-4000-8000-000000000003',names:['System control secret'],purpose:'Synthetic system metadata',category:'system',connections:[],revealAllowed:false}];
items.push({...base,reference:'00000000-0000-4000-8000-000000000004',names:['gpt-image2 · 账务'],purpose:'当前连接：gpt-image2 · 账务',category:'connection',connections:[{connectionId:'synthetic-connection',name:'gpt-image2 · 账务',provider:'OpenAI',version:1,current:true,revoked:false}]});
let revealAttempts=0;
window.fetch=async(input,init)=>{const path=String(input).split('/api/local/')[1],url=new URL(String(input),location.origin);const respond=(value:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}));if(path==='session')return respond({csrfToken:'synthetic-only'});if(path?.startsWith('secrets?')){const category=url.searchParams.get('category'),q=(url.searchParams.get('q')||'').toLowerCase(),filtered=items.filter(item=>(category==='all'||item.category===category)&&JSON.stringify(item).toLowerCase().includes(q));return respond({items:filtered,total:filtered.length,page:1,pageSize:50,categoryCounts:{connection:2,history:1,system:1}});}if(path?.startsWith('secrets/detail?'))return respond({item:items.find(item=>item.reference===url.searchParams.get('reference'))});if(path==='secrets/reveal'){revealAttempts++;if(params.has('fail')&&revealAttempts===1)return respond({error:'Synthetic verification failed'},403);return respond({value:'synthetic-browser-value-only',expiresAt:new Date(Date.now()+30000).toISOString()});}return respond({error:'Synthetic harness rejects unrelated API'},400);};
function Harness(){const ref=useRef<HTMLButtonElement>(null),[busy,setBusy]=useState(false),[closed,setClosed]=useState(false);return <div className="dan-ui product-ui"><button ref={ref} onClick={()=>setClosed(false)}>Synthetic acceptance only</button>{!closed&&<OwnerSettingsDialog page="secrets" onNavigate={()=>setClosed(true)} onClose={()=>setClosed(true)} returnFocusRef={ref} canManageSecrets busy={busy} email="synthetic@example.invalid"><LocalSecretAdministration embedded csrf="synthetic-only" onClose={()=>setClosed(true)} onStateChange={state=>setBusy(state.busy)} onOpenConnection={()=>setClosed(true)}/></OwnerSettingsDialog>}</div>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
