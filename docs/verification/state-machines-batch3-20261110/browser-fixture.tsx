import {StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceExportPanel} from '../../../src/local-app/WorkspaceExportPanel';
import type {ProductionWorkspace} from '../../../src/productionWorkspace';
import {scenario,scenarios} from './fixture-data.mjs';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/local-app/production-compact.css';
function Fixture(){
 const [name,setName]=useState('await-confirmation'),[w,setWorkspace]=useState(()=>scenario('await-confirmation')),[events,setEvents]=useState<string[]>([]);
 async function choose(name:string){const response=await fetch('/__fixture-case',{method:'POST',body:JSON.stringify({name})});setWorkspace((await response.json()).workspace);setName(name);}
 async function command(command:string,data:unknown){const response=await fetch('/__fixture-command',{method:'POST',body:JSON.stringify({command,data})});const result=await response.json();if(!response.ok)throw Error(result.error);setEvents(current=>[...current,command+':'+JSON.stringify(data)]);return result.workspace;}
 return <div className="app-shell dan-ui product-ui"><main style={{padding:24,minWidth:0}}><h1>导出与交付下一步核对</h1><label>核对状态<select aria-label="核对状态" value={name} onChange={event=>void choose(event.target.value)}>{scenarios.map(value=><option key={value}>{value}</option>)}</select></label><WorkspaceExportPanel key={name} workspace={w as ProductionWorkspace} pending={false} command={command} onChange={setWorkspace}/><ol aria-label="核对事件">{events.map((event,index)=><li key={index}>{event}</li>)}</ol></main></div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
