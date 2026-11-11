import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceNarrationPanel} from '../../../src/local-app/WorkspaceNarrationPanel';
import {AccountDirectoryPanel} from '../../../src/accounts/AccountDirectoryPanel';
import {WorkspaceDraftOwner} from '../../../src/local-app/WorkspaceDraft';
import {localCommand,localRequest} from '../../../src/local-app/client';
import '../../../src/styles.css';
import '../../../src/local-app/production-compact.css';
import '../../../src/local-app/workspace-visual-preparation.css';
import '../../../src/local-app/workspace-visual-candidates.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/maintenance.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/ui/impeccable/scroll-layout.css';
import '../../../src/ui/impeccable/surface-polish.css';
import '../../../src/ui/impeccable/detail-refinement.css';
const command=(name:string,data:unknown)=>localCommand(name,data,undefined,'episode-commands');
const fixture=window as any;fixture.copies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:(path:string)=>{fixture.copies.push(path);return new Promise<void>(resolve=>{fixture.copyDone=resolve;});}}});
function Fixture(){
 const [data,setData]=useState<any>(),[workspace,setWorkspace]=useState<any>(),[materials,setMaterials]=useState<any[]>([]),[open,setOpen]=useState(true),[shot,setShot]=useState('S01'),[owner,setOwner]=useState('manual-owner'),[account,setAccount]=useState('account-a');
 useEffect(()=>{void fetch('/__state').then(r=>r.json()).then(d=>{setData(d);setWorkspace(d.workspace);});},[]);if(!data)return null;
 const importAudio=async(files:File[])=>{const ids:string[]=[];for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer());const m:any=await command('importMaterial',{episodeId:workspace.episodeId,sourceKind:'file',sourcePath:file.name,materialType:'audio',mimeType:file.type,contentBase64:btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')),isMainScript:false});ids.push(m.id);setMaterials(values=>[...values,m]);}return ids;};
 return <main className="impeccable-app dan-ui product-ui" style={{padding:16,maxWidth:900,margin:'auto'}}><div style={{display:'flex',flexWrap:'wrap',gap:12,marginBottom:20}}><button onClick={()=>setOpen(v=>!v)}>{open?'关闭面板':'重新打开面板'}</button>{data.view==='manual'?<><button onClick={()=>setShot('S01')}>镜头 01</button><button onClick={()=>setShot('S02')}>镜头 02</button><button onClick={()=>setOwner(v=>v==='manual-owner'?'other-owner':'manual-owner')}>切换 Owner</button></>:<><button onClick={()=>setAccount('account-a')}>账号 A</button><button onClick={()=>setAccount('account-b')}>账号 B</button><button onClick={()=>fixture.copyDone?.()}>完成复制</button></>}</div>{open&&(data.view==='manual'?<WorkspaceDraftOwner ownerId={owner}><WorkspaceNarrationPanel episodeId={workspace.episodeId} workspace={workspace} selectedShotId={shot} pending={false} command={command} onChanged={setWorkspace} materials={materials} onImportAudio={importAudio}/></WorkspaceDraftOwner>:<AccountDirectoryPanel accountId={account}/>)}</main>;
}
async function start(){await localRequest('session');createRoot(document.getElementById('root')!).render(<Fixture/>);}void start();
