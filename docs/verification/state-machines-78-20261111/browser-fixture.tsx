import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MediaRootSettingsDialog} from '../../../src/local-app/MediaRootSettingsDialog';
import {ProductionWorkspacePanel} from '../../../src/local-app/ProductionWorkspacePanel';
import {WorkspaceVisualPreparation} from '../../../src/local-app/WorkspaceVisualPreparation';
import {WorkspaceDraftOwner} from '../../../src/local-app/WorkspaceDraft';
import {localCommand} from '../../../src/local-app/client';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/maintenance.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/ui/impeccable/scroll-layout.css';
import '../../../src/ui/impeccable/surface-polish.css';
import '../../../src/ui/impeccable/detail-refinement.css';
import '../../../src/ui/impeccable/interaction-refinement.css';
const command=(name:string,data:unknown)=>localCommand(name,data,undefined,'episode-commands');
function Fixture(){
 const [data,setData]=useState<any>(),[workspace,setWorkspace]=useState<any>(),[open,setOpen]=useState(true);
 useEffect(()=>{void fetch('/__state').then(r=>r.json()).then(d=>{setData(d);setWorkspace(d.workspace);});},[]);
 if(!data)return null;
 return <main className="impeccable-app dan-ui product-ui" style={{padding:16,maxWidth:1400,margin:'auto'}}><WorkspaceDraftOwner ownerId="fixture-78"><button onClick={()=>setOpen(v=>!v)}>{open?'关闭验收面板':'重开验收面板'}</button>{open&&(data.view==='storage'?<MediaRootSettingsDialog csrf="fixture" embedded onClose={()=>setOpen(false)}/>:data.view==='shelf'?<ProductionWorkspacePanel episodeId={workspace.episodeId} title="上传恢复验收" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>:<WorkspaceVisualPreparation workspace={workspace} command={command} onChange={setWorkspace} materials={[]}/>)}</WorkspaceDraftOwner></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
