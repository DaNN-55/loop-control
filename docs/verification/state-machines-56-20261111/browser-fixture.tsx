import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {EmbeddedStudioHost} from '../../../src/local-app/EmbeddedStudioHost';
import {WorkspaceCaptionsPanel} from '../../../src/local-app/WorkspaceCaptionsPanel';
import {WorkspaceVisualPreparation} from '../../../src/local-app/WorkspaceVisualPreparation';
import {WorkspaceDraftOwner} from '../../../src/local-app/WorkspaceDraft';
import {GlobalPlanningSettings} from '../../../src/local-app/GlobalPlanningSettings';
import {ConnectionPlanningTable} from '../../../src/local-app/WorkspacePlanningSelection';
import {localCommand,localRequest} from '../../../src/local-app/client';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/local-app/production-compact.css';
const command=(name:string,data:unknown)=>localCommand(name,data,undefined,'episode-commands');
function App({initial,session,ownerId,mode}:any){
 const [workspace,setWorkspace]=useState(initial),[visible,setVisible]=useState(true);const current=useRef(workspace);current.current=workspace;
 if(mode==='global')return <main className="dan-ui product-ui" style={{padding:16}}><GlobalPlanningSettings/></main>;
 if(mode==='planning')return <main className="dan-ui product-ui" style={{padding:16}}><ConnectionPlanningTable initialEpisode={{episodeId:initial.episodeId,title:'隔离生产单'}}/></main>;
 return <main className="dan-ui product-ui" style={{padding:16}}><WorkspaceDraftOwner ownerId={ownerId}>
 {mode==='uploads'?<><button onClick={()=>setVisible(v=>!v)}>{visible?'关闭素材面板':'重开素材面板'}</button>{visible&&<WorkspaceVisualPreparation workspace={workspace} command={command} onChange={setWorkspace} materials={[]}/>}</>:
 mode==='plain'?<WorkspaceCaptionsPanel workspace={workspace} command={command} onChange={setWorkspace}/>:
 <EmbeddedStudioHost episodeId={workspace.episodeId} title="真实字幕恢复验收" session={session} shots={workspace.clips.map((c:any)=>({id:c.shotId,text:c.text}))} onSave={async file=>{
  const saved:any=await command('saveWorkspaceStudio',{episodeId:workspace.episodeId,workspaceId:workspace.id,expectedRevision:current.current.revision,workspaceRelativePath:file.relativePath,projectId:file.projectId,expectedWorkspaceSha256:file.sha256});
  setWorkspace(saved.productionWorkspace);return saved;
 }} onClose={()=>{}} captionEditor={bridge=><WorkspaceCaptionsPanel workspace={workspace} command={command} onChange={setWorkspace} bridge={bridge}/>}/>}
 </WorkspaceDraftOwner></main>;
}
async function start(){await localRequest('session');const r=await fetch('/__state');createRoot(document.getElementById('root')!).render(<App {...await r.json()}/>);}void start();
