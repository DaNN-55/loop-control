// Browser-only synthetic transport; imports the actual settings shell and recycle component.
// All requests are intercepted here. No daily backend or real files are used.
import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RecycleBinDialog} from '../../../../src/local-app/RecycleBinPanel';
import {OwnerSettingsDialog} from '../../../../src/local-app/OwnerSettingsDialog';
import {setUiLocale} from '../../../../src/i18n/ui';
import '../../../../src/styles.css';
import '../../../../src/ui/impeccable/foundation.css';
import '../../../../src/ui/impeccable/configuration.css';
import '../../../../src/ui/impeccable/maintenance.css';
import '../../../../src/ui/impeccable/production.css';
import '../../../../src/ui/impeccable/scroll-layout.css';
import '../../../../src/ui/impeccable/surface-polish.css';
import '../../../../src/ui/impeccable/detail-refinement.css';
import '../../../../src/ui/impeccable/interaction-refinement.css';
const params=new URLSearchParams(location.search);
setUiLocale(params.get('lang')==='en'?'en-US':'zh-CN');
document.documentElement.dataset.theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.dataset.interface='impeccable';
const items=params.get('empty')?[]:[
 {episodeId:'00000000-0000-4000-a000-000000000001',revision:'00000000-0000-4000-a000-000000000011',title:'窗边的一杯咖啡 · 试剪版',accountName:'体验审查',recycledAt:'2026-11-05T08:30:00Z',archivedBefore:false,sizeBytes:1800000000,protection:''},
 {episodeId:'00000000-0000-4000-a000-000000000002',revision:'00000000-0000-4000-a000-000000000012',title:'很长的生产单名称'.repeat(14),accountName:'Account with a very long unbroken name '.repeat(4),recycledAt:'2026-11-08T04:16:00Z',archivedBefore:true,sizeBytes:500000000,protection:'其他生产单仍有引用，暂不自动清理。'},
];
let limit=5000000000,revision=1;
window.fetch=async(input,init)=>{
 const url=String(input),path=url.split('/api/local/')[1];
 const ok=(value:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}));
 if(path==='session')return ok({csrfToken:'synthetic-test-only'});
 if(path==='deletion-cleanups')return ok([]);
 if(path!=='recycle-bin')return ok({error:'Synthetic transport rejects unrelated request'},400);
 if(init?.method!=='POST')return ok({items,limitBytes:limit,settingsRevision:revision,usedBytes:items.reduce((n,v)=>n+v.sizeBytes,0),pendingBytes:0,overLimit:false});
 const body=JSON.parse(String(init.body)),data=body.data;
 if(body.command==='saveRecycleLimit'){limit=data.limitBytes;revision++;return ok({settingsRevision:revision});}
 if(body.command==='planRecyclePurge')return ok({confirmation:items.find(v=>v.episodeId===data.episodeId)?.title,path:'/synthetic/order',paths:['/synthetic/order'],revision:'synthetic-plan',files:[{path:'script.md',bytes:20,authority:'registered'}],preserved:[]});
 if(body.command==='restoreRecycledEpisode'||body.command==='purgeRecycledEpisode'){const i=items.findIndex(v=>v.episodeId===data.episodeId);if(i>=0)items.splice(i,1);return ok({restored:true});}
 return ok({error:'Unsupported synthetic command'},400);
};
function Harness(){
 const ref=useRef<HTMLButtonElement>(null),[state,setState]=useState({busy:false,dirty:false}),[closed,setClosed]=useState(false);
 return <div className="dan-ui product-ui"><button ref={ref} onClick={()=>setClosed(false)}>隔离验收 · 仅合成数据</button>{!closed&&<OwnerSettingsDialog page="cleanup" onNavigate={()=>{if(!state.busy&&!state.dirty)setClosed(true);}} onClose={()=>{if(!state.busy&&!state.dirty)setClosed(true);}} returnFocusRef={ref} canManageSecrets busy={state.busy} email="synthetic@example.invalid"><RecycleBinDialog revision={0} embedded onStateChange={setState} onClose={()=>{if(!state.busy&&!state.dirty)setClosed(true);}} returnFocusRef={ref}/></OwnerSettingsDialog>}</div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
