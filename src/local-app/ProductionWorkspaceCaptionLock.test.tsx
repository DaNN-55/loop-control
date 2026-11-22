import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import type {ProductionWorkspace} from '../productionWorkspace';
vi.mock('./WorkspaceCaptionAutomation',()=>({WorkspaceCaptionAutomation:({workspace,command,onChange}:{workspace:ProductionWorkspace;command:(name:string,data:unknown)=>Promise<unknown>;onChange:(w:ProductionWorkspace)=>void})=><button onClick={()=>void command('requestWorkspaceCaptionAlignment',{episodeId:'e',workspaceId:workspace.id,expectedRevision:workspace.revision}).then(w=>onChange(w as ProductionWorkspace))}>start automatic alignment</button>}));
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('holds shot selection while the automatic caption command updates the shared workspace',async()=>{
 const workspace={id:'w',episodeId:'e',revision:1,scriptRevisionId:'s',clips:[{id:'c',itemId:'i',shotId:'S1',text:'第一镜',source:null},{id:'c2',itemId:'i2',shotId:'S2',text:'第二镜',source:null}],project:{relativePath:'p.json',sha256:'a'.repeat(64),fileSize:2,projectId:'p'},readiness:{deliverable:false,placeholders:['i','i2'],missingSources:[]},stale:false} as unknown as ProductionWorkspace;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 let finish!:(value:ProductionWorkspace)=>void;const command=vi.fn(()=>new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}));
 render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');fireEvent.click(screen.getByRole('button',{name:'start automatic alignment'}));
 expect(screen.getByRole('button',{name:'选择镜头 02'})).toHaveProperty('disabled',true);
 await act(async()=>finish({...workspace,revision:2}));
 expect(screen.getByRole('button',{name:'选择镜头 02'})).toHaveProperty('disabled',false);
});
