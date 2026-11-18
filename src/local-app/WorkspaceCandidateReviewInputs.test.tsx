import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ProductionWorkspace} from '../productionWorkspace';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';

const image={id:'image',kind:'image',usage:'still',targetItemId:'visual',shotId:'S1',status:'available',relativePath:'candidate.png',sha256:'a'.repeat(64),materialRevisionId:'material',durationSeconds:3,currentDurationSeconds:2};
const workspace={id:'workspace',episodeId:'episode',revision:3,stale:false,project:{sha256:'original'},clips:[{id:'clip',itemId:'visual',shotId:'S1',text:'山峰'}],visualCandidates:[image]} as unknown as ProductionWorkspace;
const plan={adoptionId:'prepared',candidateId:'image',projectSha256:'original',edit:{},impact:{currentSeconds:2,sourceSeconds:3,appliedSeconds:3,deltaSeconds:1,startSeconds:0,endSeconds:3,fps:30,affectedFragments:[{itemId:'next',label:'下一镜',kind:'image',track:'visual',startSeconds:2,endSeconds:4,changedStartSeconds:2,changedEndSeconds:3}]}};
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
function prepareImage(){fireEvent.click(screen.getByRole('button',{name:'作为镜头画面'}));}
it('does not reopen a late visual impact dialog after an external project change',async()=>{
 let resolve!:(value:unknown)=>void;const delayed=new Promise(done=>{resolve=done;});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(()=>delayed),props={workspace,command,onChange:()=>{},materials:[]};
 const view=render(<WorkspaceVisualPreparation {...props}/>);prepareImage();await waitFor(()=>expect(command).toHaveBeenCalledOnce());
 view.rerender(<WorkspaceVisualPreparation {...props} workspace={{...workspace,revision:4,project:{...workspace.project,sha256:'external'}}}/>);
 await act(async()=>{resolve(plan);await delayed;});expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByRole('button',{name:'确认采用'})).toBeNull();
 expect(screen.getByRole('button',{name:'作为镜头画面'})).toHaveProperty('disabled',false);expect(command).toHaveBeenCalledTimes(1);
});
it('keeps a fresh read baseline and publishes the adoption new SHA through the real visual input',async()=>{
 const fresh={...workspace,revision:4,project:{...workspace.project,sha256:'fresh'}},changed={...fresh,revision:5,project:{...fresh.project,sha256:'adopted'}};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:fresh})));const command=vi.fn(async(name)=>name==='prepareWorkspaceVisualCandidate'?{...plan,projectSha256:'fresh'}:changed);
 function Harness(){const[w,setW]=useState(workspace);return <WorkspaceVisualPreparation workspace={w} command={command} onChange={setW} materials={[]}/>;}
 render(<Harness/>);prepareImage();await screen.findByRole('dialog',{name:'采用前核对'});fireEvent.click(screen.getByRole('button',{name:'确认采用'}));
 expect(await screen.findByText('已采用图片。')).toBeTruthy();expect(command).toHaveBeenLastCalledWith('adoptWorkspaceVisualCandidate',{episodeId:'episode',workspaceId:'workspace',expectedRevision:4,candidateId:'image',adoptionId:'prepared'});
});
it('replacing a video with an image uses a server-prepared identity and confirms actual impacts',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?plan:{...workspace,revision:4});
 render(<WorkspaceVisualPreparation workspace={workspace} command={command} onChange={()=>{}} materials={[]} currentVisualKind="video"/>);
 fireEvent.click(screen.getByRole('tab',{name:'图片'}));fireEvent.click(screen.getByRole('button',{name:'作为镜头画面'}));
 await screen.findByRole('dialog',{name:'采用前核对'});expect(command).toHaveBeenCalledWith('prepareWorkspaceVisualCandidate',expect.objectContaining({replaceCurrentVisual:true}));
 fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(command).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'作为镜头画面'}));await screen.findByRole('dialog',{name:'采用前核对'});fireEvent.click(screen.getByRole('button',{name:'确认采用'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',expect.objectContaining({candidateId:'image',adoptionId:'prepared'})));expect(command.mock.calls.some(c=>c[0]==='retainWorkspaceImageCandidate')).toBe(false);
});
