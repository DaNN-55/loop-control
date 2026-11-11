import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceNarrationPanel} from '../../../src/local-app/WorkspaceNarrationPanel';
import {WorkspaceAudioPreparation} from '../../../src/local-app/WorkspaceAudioPanel';
import {WorkspaceVisualPreparation} from '../../../src/local-app/WorkspaceVisualPreparation';
import {WorkspaceMaterialSelectionProvider,useWorkspaceMaterialSelection,workspaceMaterialDragType} from '../../../src/local-app/WorkspaceMaterialDrop';
import {WorkspaceDraftOwner} from '../../../src/local-app/WorkspaceDraft';
import {localCommand} from '../../../src/local-app/client';
import '../../../src/local-app/production-compact.css';
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
function Materials(){const shelf=useWorkspaceMaterialSelection()!;return <aside style={{padding:16,border:'1px solid var(--lc-line)',borderRadius:12}}><h2>本期素材</h2><p>镜头 01 · 测试口播与字幕</p>{shelf.materials.map(m=><button key={m.id} draggable data-material={m.id} aria-label={`选取 ${m.source_path}`} onClick={()=>shelf.select(m.id)} onDragStart={event=>{shelf.drag(m.id);event.dataTransfer.setData(workspaceMaterialDragType,m.id);}} onDragEnd={()=>shelf.drag('')} style={{display:'block',maxWidth:'100%',marginBottom:8,textAlign:'left',overflowWrap:'anywhere'}}>{m.source_path}</button>)}</aside>;}
function Fixture(){
 const [data,setData]=useState<any>(null),[w,setW]=useState<any>(null),[materials,setMaterials]=useState<any[]>([]),[tracks,setTracks]=useState<any[]>([]);
 useEffect(()=>{void fetch('/__state').then(r=>r.json()).then(d=>{setData(d);setW(d.workspace);setMaterials(d.materials);setTracks(d.tracks);sessionStorage.setItem(`loop-speech-draft:${d.workspace.id}:S1:mode`,d.view==='manual'?'manual':'tts');sessionStorage.setItem(`loop-narration-tab:${d.workspace.id}`,d.view==='captions'?'captions':'voice');});},[]);
 if(!data||!w)return <p>读取验收数据…</p>;
 const change=(value:any)=>{setW(value);void fetch('/__state').then(r=>r.json()).then(d=>setTracks(d.tracks));};
 const importAudio=async(files:File[])=>{const ids:string[]=[];for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer());const contentBase64=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));const material:any=await command('importMaterial',{episodeId:'e',sourceKind:'file',sourcePath:file.name,materialType:'audio',materialPurpose:'narration',mimeType:file.type,isMainScript:false,contentBase64});ids.push(material.id);setMaterials(old=>[...old,material]);}return ids;};
 return <main className="impeccable-app dan-ui product-ui" style={{padding:20,maxWidth:1440,margin:'auto'}}><WorkspaceDraftOwner ownerId="fixture-owner"><WorkspaceMaterialSelectionProvider materials={materials}>
 <div className="fixture-grid"><Materials/><section style={{minWidth:0}}>{data.view==='music'?<WorkspaceAudioPreparation workspace={w} command={command} onChange={change} materials={materials} selectedShotId="S1"/>:data.view==='image'||data.view==='video'?<WorkspaceVisualPreparation workspace={w} command={command} onChange={change} materials={materials} currentVisualKind={data.view} project={null}/>:<WorkspaceNarrationPanel episodeId="e" workspace={w} selectedShotId="S1" tracks={tracks} materials={materials} pending={false} command={command} onChanged={change} onImportAudio={importAudio}/>}</section></div>
 <label style={{display:'block',marginTop:30}}>独立字段<textarea aria-label="独立字段" rows={2}/></label>
 </WorkspaceMaterialSelectionProvider></WorkspaceDraftOwner></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
