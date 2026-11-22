import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceVisualPreparation} from '../../../src/local-app/WorkspaceVisualPreparation';
import {WorkspaceAudioInstanceSettings} from '../../../src/local-app/WorkspaceAudioInstanceSettings';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/local-app/workspace-audio.css';
import type {ProductionWorkspace} from '../../../src/productionWorkspace';
import type {OpenChatCutProject} from '../../../src/worker/openchatcutProject';
function Fixture(){
 const [state,setState]=useState<{workspace:ProductionWorkspace;project:OpenChatCutProject}|null>(null),[revision,setRevision]=useState(0),[notice,setNotice]=useState('');
 async function refresh(){const response=await fetch('/__crop/state');setState(await response.json());setRevision(v=>v+1);}
 useEffect(()=>{void refresh();},[]);
 async function command(name:string,data:unknown){const r=await fetch('/__crop/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})}),body=await r.json();if(!r.ok)throw Error(body.error);return body;}
 if(!state)return <p>读取隔离工程…</p>;
 const {workspace:w,project}=state,clip=w.clips[0],sound=w.audio!.mix.sounds[0],prep=w.audio!.preparations.find(p=>p.adoptedItemId===sound.itemId)!,visual=project.timelines.flatMap(t=>t.items).find(i=>i.id===clip.itemId)!;
 return <main className="workspace-preparation" style={{maxWidth:800,margin:'24px auto',padding:16}}><h1>隔离工程 · 实际裁剪保存</h1><p>使用正式组件和真实本机保存命令。合成素材，无正式业务数据。</p><p role="status">{notice}</p><button onClick={()=>void refresh()}>重新读取工程</button><h2>视频</h2><WorkspaceVisualPreparation workspace={w} project={project} materials={[]} command={command} onChange={()=>void refresh()} currentVisualKind="video" currentVisualPath={String(visual.src)} currentVisualSha256={clip.source?.sha256}/><h2>音效</h2><WorkspaceAudioInstanceSettings key={revision} sound={sound} workspaceId={w.id} project={project} shotId={clip.shotId} shotItemIds={[clip.itemId]} src={'/_local-artifact?'+new URLSearchParams({episode:w.episodeId,path:prep.relativePath!,sha256:prep.sha256!})} disabled={false} apply={async edit=>{try{await command('mixWorkspaceAudio',{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,edit});setNotice('音效裁剪已保存');await refresh();return true;}catch(error){setNotice(String(error));return false;}}} onApplied={()=>{}}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
