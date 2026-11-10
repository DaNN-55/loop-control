import {StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceSpeechSample} from '../../../src/local-app/WorkspaceSpeechSample';
import {ConnectionModelsDialog,type ConnectionModelDraft} from '../../../src/connections/ConnectionModelsDialog';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/connections/connections.css';
async function json(path:string,data?:unknown){const response=await fetch(path,data===undefined?undefined:{method:'POST',body:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;}
function Fixture(){
 const[panel,setPanel]=useState('sample'),[voice,setVoice]=useState('A'),[rate,setRate]=useState(1),[sampleCase,setSampleCase]=useState('cached'),[visit,setVisit]=useState(0),[plays,setPlays]=useState<string[]>([]),[modelCase,setModelCase]=useState('clean'),[open,setOpen]=useState(false),[draft,setDraft]=useState<ConnectionModelDraft>();
 useEffect(()=>{const play=(event:Event)=>{if(event.target instanceof HTMLAudioElement)setPlays(v=>[...v,event.target.src]);};document.addEventListener('playing',play,true);return()=>document.removeEventListener('playing',play,true);},[]);
 return <div className="app-shell dan-ui product-ui"><main style={{padding:24,minWidth:0,gridColumn:'1 / -1'}}><h1>样音与模型基线核对</h1><label>核对面板<select aria-label="核对面板" value={panel} onChange={e=>setPanel(e.target.value)}><option value="sample">样音</option><option value="models">模型设置</option></select></label>
 {panel==='sample'?<><label>样音场景<select aria-label="样音场景" value={sampleCase} onChange={async e=>{const name=e.target.value;await json('/_sample-case',{name});setSampleCase(name);setVoice('A');setRate(1);setVisit(v=>v+1);setPlays([]);}}>{['cached','missing','delayed'].map(v=><option key={v}>{v}</option>)}</select></label><label>音色<select aria-label="音色" value={voice} onChange={e=>setVoice(e.target.value)}><option>A</option><option>B</option></select></label><label>语速<input aria-label="语速" type="number" step="0.1" value={rate} onChange={e=>setRate(Number(e.target.value))}/></label><WorkspaceSpeechSample key={visit} label="当前" selection={{capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:'fixture'}} voice={voice} rate={rate} disabled={false}/><button onClick={()=>void json('/__release/A')}>释放 A</button><button onClick={()=>void json('/__release/B')}>释放 B</button><output aria-label="实际播放次数">{plays.length}</output></>:<><label>模型场景<select aria-label="模型场景" value={modelCase} onChange={async e=>{const name=e.target.value;await json('/_model-case',{name});setModelCase(name);setDraft(undefined);}}>{['clean','concurrent','discovery','save-race'].map(v=><option key={v}>{v}</option>)}</select></label><button onClick={()=>setOpen(true)}>打开模型设置</button>{open&&<ConnectionModelsDialog connection={{id:'c',name:'模型基线核对'}} draft={draft} onDraftChange={value=>{setDraft(value??undefined);void json('/__draft',value);}} onClose={()=>setOpen(false)} onReadModels={()=>json('/__models/read')} onSyncModels={data=>json('/__models/sync',data)} onSaveModels={data=>json('/__models/save',data)}/>}</>}
 </main></div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
