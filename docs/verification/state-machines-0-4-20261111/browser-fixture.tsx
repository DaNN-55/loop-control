import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OwnerPreferencesDialog} from '../../../src/local-app/OwnerPreferencesDialog';
import {defaultOwnerPreferences} from '../../../src/preferences/preferences';
import {WorkspaceAudioPreparation} from '../../../src/local-app/WorkspaceAudioPanel';
import {ConnectionModelsDialog} from '../../../src/connections/ConnectionModelsDialog';
import {EmbeddedStudioHost} from '../../../src/local-app/EmbeddedStudioHost';
import {WorkspaceCaptionsPanel} from '../../../src/local-app/WorkspaceCaptionsPanel';
import {WorkspaceDeliveryPanel} from '../../../src/local-app/WorkspaceDeliveryPanel';
import {ProductionWorkspacePanel} from '../../../src/local-app/ProductionWorkspacePanel';
import {WorkspaceDraftOwner} from '../../../src/local-app/WorkspaceDraft';
import {localCommand} from '../../../src/local-app/client';
import type {ProductionWorkspace} from '../../../src/productionWorkspace';
import type {OpenChatCutStudioWorkspace} from '../../../src/reviews/reviewRevision';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/local-app/production-compact.css';
const command=(name:string,data:unknown)=>localCommand(name,data,undefined,'episode-commands');
function Models(){
 const [id,setId]=useState('old'),[visible,setVisible]=useState(true);
 Object.assign(window,{changeFixtureConnection:()=>setId('new')});
 return visible?<ConnectionModelsDialog connection={{id,name:id==='old'?'旧连接':'新连接'}} onClose={()=>setVisible(false)} onReadModels={id=>fetch('/__models?id='+id).then(response=>response.json())} onSaveModels={input=>fetch('/__model-save',{method:'POST',body:JSON.stringify(input)}).then(response=>response.json())}/>:<p>模型设置已关闭</p>;
}
function Preferences(){
 const [error,setError]=useState(''),attempts=useRef(0);
 return <OwnerPreferencesDialog preferences={defaultOwnerPreferences} page="personal" loading={false} saving={false} unavailable={false} error={error} onReload={()=>{}} onClose={()=>{}} onSave={async value=>{
  Object.assign(window,{preferenceAttempts:++attempts.current});setError('');
  try{await localCommand('update',value,undefined,'preferences');return true;}catch(cause){setError(String(cause));return false;}
 }}/>;
}
function Captions({initial,studio}:{initial:ProductionWorkspace;studio:OpenChatCutStudioWorkspace}){
 const [workspace,setWorkspace]=useState(initial),current=useRef(workspace);current.current=workspace;
 return <EmbeddedStudioHost episodeId="e" title="字幕保存接续" session={{studioUrl:'http://127.0.0.1:5197/__studio#/editor/loop-control-e',workspace:studio,sourcePath:'project.json'}} shots={[]} onSave={async file=>{
  const result=await command('saveWorkspaceStudio',{episodeId:'e',workspaceId:'w',expectedRevision:current.current.revision,workspaceRelativePath:file.relativePath,projectId:file.projectId,expectedWorkspaceSha256:file.sha256}) as OpenChatCutStudioWorkspace&{productionWorkspace:ProductionWorkspace};setWorkspace(result.productionWorkspace);return result;
 }} onClose={()=>{}} captionEditor={bridge=><WorkspaceCaptionsPanel workspace={workspace} command={command} onChange={setWorkspace} bridge={bridge}/>}/>;
}
function Fixture(){
 const [data,setData]=useState<{mode:string;workspace:ProductionWorkspace;studio:OpenChatCutStudioWorkspace}|null>(null),[workspace,setWorkspace]=useState<ProductionWorkspace|null>(null);
 useEffect(()=>{void fetch('/__state').then(response=>response.json()).then(data=>{setData(data);setWorkspace(data.workspace);});},[]);
 if(!data||!workspace)return <p>夹具读取中…</p>;
 return <main className="dan-ui product-ui" style={{padding:16,minWidth:0}}><WorkspaceDraftOwner ownerId="fixture-owner">{data.mode.startsWith('models')?<Models/>:data.mode==='preferences'?<Preferences/>:data.mode.startsWith('audio')?<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={setWorkspace}/>:data.mode==='uploads'?<ProductionWorkspacePanel episodeId="e" title="素材上传接续" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>:data.mode==='delivery'?<WorkspaceDeliveryPanel workspace={workspace} pending={false} command={command} onChange={setWorkspace}/>:<Captions initial={workspace} studio={data.studio}/>}</WorkspaceDraftOwner></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
