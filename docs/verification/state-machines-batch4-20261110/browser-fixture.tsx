import {StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProductionWorkspacePanel} from '../../../src/local-app/ProductionWorkspacePanel';
import {WorkspaceDraftProvider} from '../../../src/local-app/WorkspaceDraft';
import {localCommand,localRequest} from '../../../src/local-app/client';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/local-app/production-compact.css';
function Fixture(){
 const[name,setName]=useState('start-failed'),[snapshot,setSnapshot]=useState<any>(null);
 async function choose(value:string){const r=await fetch('/__case',{method:'POST',body:JSON.stringify({name:value})});setSnapshot((await r.json()).sections);setName(value);}
 useEffect(()=>{void fetch('/__state').then(r=>r.json()).then(value=>{setName(value.name);setSnapshot(value.sections);});},[]);
 async function command(name:string,data:unknown){const result=await localCommand(name,data,undefined,'episode-commands');const value=await localRequest('episodes/'+snapshot.episode.id);setSnapshot(value.sections);return result;}
 return <div className="app-shell dan-ui product-ui"><main style={{padding:24,minWidth:0,gridColumn:'1 / -1'}}><label>核对场景<select aria-label="核对场景" value={name} onChange={e=>void choose(e.target.value)}>{['start-failed','unknown-start','save-failed','revision-start-failed','conflict','read-failed'].map(v=><option key={v}>{v}</option>)}</select></label>{snapshot&&<WorkspaceDraftProvider key={name} ownerId="fixture-owner"><ProductionWorkspacePanel episodeId={snapshot.episode.id} title="脚本分步核对" scriptRevisionId={snapshot.episode.main_script_revision_id} stage={snapshot.episode.stage} materials={snapshot.materialRevisions} command={command} onLegacy={()=>{}}/></WorkspaceDraftProvider>}</main></div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
