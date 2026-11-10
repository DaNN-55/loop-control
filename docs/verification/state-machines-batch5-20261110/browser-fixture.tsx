import {StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProductionWorkspacePanel} from '../../../src/local-app/ProductionWorkspacePanel';
import {WorkspaceNavigationContext} from '../../../src/local-app/catalogNavigation';
import type {ProductionStep} from '../../../src/episodes/episodeCatalogTypes';
import {WorkspaceDraftProvider} from '../../../src/local-app/WorkspaceDraft';
import {localCommand} from '../../../src/local-app/client';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/local-app/production-compact.css';
function Fixture(){
 const[mode,setMode]=useState('ready'),[key,setKey]=useState(0),[step,setStep]=useState<ProductionStep>(()=>new URLSearchParams(location.search).get('step') as ProductionStep||'preparation');
 useEffect(()=>{const pop=()=>setStep(new URLSearchParams(location.search).get('step') as ProductionStep||'preparation');addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop);},[]);
 function change(patch:{step?:ProductionStep}){if(patch.step){history.pushState(null,'','?step='+patch.step);setStep(patch.step);}}
 async function choose(value:string){await fetch('/__case',{method:'POST',body:JSON.stringify({mode:value})});localStorage.clear();sessionStorage.clear();history.replaceState(null,'','?step=preparation');setStep('preparation');setMode(value);setKey(v=>v+1);}
 return <div className="app-shell dan-ui product-ui"><main style={{padding:24,minWidth:0,gridColumn:'1 / -1',display:'flex',flexDirection:'column',height:'100vh'}}><label>核对场景<select aria-label="核对场景" value={mode} onChange={e=>void choose(e.target.value)}>{['ready','prepare-failed','open-failed','save-failed','close-failed','flush-failed','slow-open'].map(v=><option key={v}>{v}</option>)}</select></label><button onClick={()=>void fetch('/__release')}>释放旧打开结果</button><WorkspaceDraftProvider key={key} ownerId="fixture-owner"><WorkspaceNavigationContext.Provider value={{episode:'e',step,tab:'visual',change}}><ProductionWorkspacePanel episodeId="e" title="操作转换核对" scriptRevisionId="s" materials={[]} command={(name,data)=>localCommand(name,data,undefined,'episode-commands')} onLegacy={()=>{}}/></WorkspaceNavigationContext.Provider></WorkspaceDraftProvider></main></div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
