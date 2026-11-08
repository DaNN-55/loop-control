import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceVisualCandidatesPanel} from './WorkspaceVisualCandidatesPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
const candidate={id:'image',kind:'image',usage:'still',targetItemId:'visual-1',shotId:'S1',status:'available',relativePath:'candidate.png',sha256:'a'.repeat(64),durationSeconds:3,currentDurationSeconds:2};
const workspace={id:'workspace',episodeId:'episode',revision:3,stale:false,project:{sha256:'original'},clips:[{id:'clip',itemId:'visual-1',shotId:'S1',text:'山峰'}],visualCandidates:[candidate]} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('automatically previews the only applicable image without adopting or replacing the current visual',()=>{
 const command=vi.fn();render(<WorkspaceVisualCandidatesPanel preparation workspace={workspace} command={command} onChange={()=>{}} materials={[]} currentVisualKind="image" currentVisualPath="current.png" preview={<img alt="当前画面"/>}/>);
 expect(screen.getByRole('button',{name:'预览图片候选 02'}).getAttribute('aria-pressed')).toBe('true');
 expect(screen.getByRole('img',{name:'图片候选 2'}).getAttribute('src')).toContain('candidate.png');expect(screen.queryByAltText('当前画面')).toBeNull();expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'预览图片候选 01，已采用'}));expect(screen.getByAltText('当前画面')).toBeTruthy();expect(command).not.toHaveBeenCalled();
});
function adoptImage(){
 fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));
 fireEvent.click(screen.getByRole('button',{name:'采用到当前镜头'}));
}
const plan={adoptionId:'prepared',candidateId:'image',projectSha256:'original',edit:{},impact:{currentSeconds:2,sourceSeconds:3,appliedSeconds:3,deltaSeconds:1,startSeconds:0,endSeconds:3,fps:30,affectedFragments:[{itemId:'visual-2',label:'下一镜山谷',kind:'image',track:'visual',startSeconds:2,endSeconds:4,changedStartSeconds:2,changedEndSeconds:3}]}};
it('shows the prepared native duration and affected fragment before a second explicit adoption action',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?plan:workspace);
 render(<WorkspaceVisualCandidatesPanel preparation workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);
 adoptImage();
 expect(await screen.findByRole('dialog',{name:'采用前核对'})).toBeTruthy();expect(screen.getByText('当前 2.00 秒 → 采用后 3.00 秒（+1.00 秒）')).toBeTruthy();expect(screen.getByText('素材区间 3.00 秒')).toBeTruthy();expect(screen.getByText('下一镜山谷')).toBeTruthy();expect(screen.getByText(/2.00–3.00 秒/)).toBeTruthy();
 expect(command).toHaveBeenCalledExactlyOnceWith('prepareWorkspaceVisualCandidate',expect.objectContaining({durationPolicy:'keep-target',acceptTimelineImpact:false,motionPolicy:'preserve-target'}));fireEvent.click(screen.getByRole('button',{name:'确认采用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',expect.objectContaining({adoptionId:'prepared',candidateId:'image'})));
});
it('discards a prepared adoption when the authoritative project changes before confirmation',async()=>{
 let current=workspace;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:current})));const command=vi.fn(async()=>plan);
 render(<WorkspaceVisualCandidatesPanel preparation workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);adoptImage();await screen.findByRole('dialog',{name:'采用前核对'});
 current={...workspace,revision:4,project:{...workspace.project,sha256:'edited'}};fireEvent.click(screen.getByRole('button',{name:'确认采用'}));expect(await screen.findByText('工程已变化，请重新核对采用影响。')).toBeTruthy();expect(command).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:'确认采用'})).toBeNull();
});
it('clears the prepared plan when the selected candidate changes and does not auto-preview stale images or videos',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async()=>plan),props={preparation:true,workspace,command,onChange:()=>{},materials:[]};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 adoptImage();await screen.findByRole('dialog',{name:'采用前核对'});view.rerender(<WorkspaceVisualCandidatesPanel {...props} workspace={{...workspace,visualCandidates:[{...workspace.visualCandidates![0],id:'new-image'}]}}/>);expect(screen.queryByRole('dialog',{name:'采用前核对'})).toBeNull();expect(command).toHaveBeenCalledTimes(1);
 view.unmount();sessionStorage.clear();render(<WorkspaceVisualCandidatesPanel {...props} workspace={{...workspace,visualCandidates:[{...workspace.visualCandidates![0],status:'stale'},{...workspace.visualCandidates![0],id:'video',kind:'video',usage:'video'}]}}/>);expect(screen.queryByRole('img',{name:/图片候选/})).toBeNull();fireEvent.click(screen.getByRole('tab',{name:'视频'}));expect(screen.queryByLabelText('视频候选预览')).toBeNull();expect(command).toHaveBeenCalledTimes(1);
});

it.each([{kind:'image',label:'图片'},{kind:'video',label:'视频'}] as const)('requires confirmation before removing adopted $kind from the shot',async({kind,label})=>{
 const used={...candidate,kind,status:'adopted',relativePath:kind==='image'?'used.png':'used.mp4'};
 const current={...workspace,visualCandidates:[used]} as unknown as ProductionWorkspace;
 const cleared={...current,revision:4,visualCandidates:[{...used,status:'available'}]} as unknown as ProductionWorkspace;
 const command=vi.fn(async()=>cleared),onChange=vi.fn();
 const props={preparation:true,command,onChange,materials:[],workspace:current,currentVisualKind:kind,currentVisualPath:used.relativePath,currentVisualSha256:used.sha256};
 const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));
 fireEvent.click(screen.getByRole('button',{name:'取消采用'}));
 expect(screen.getByRole('dialog',{name:`取消采用${label}`})).toBeTruthy();
 expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));
 fireEvent.click(screen.getByRole('button',{name:'取消采用'}));
 fireEvent.click(screen.getByRole('button',{name:'确认取消采用'}));
 await waitFor(()=>expect(onChange).toHaveBeenCalledWith(cleared));
 expect(command).toHaveBeenCalledExactlyOnceWith('clearWorkspaceVisualCandidate',expect.objectContaining({
  targetItemId:'visual-1',candidateId:used.id,sourcePath:used.relativePath,sourceSha256:used.sha256,expectedRevision:3,
 }));
 view.rerender(<WorkspaceVisualCandidatesPanel {...props} workspace={cleared} currentVisualKind={undefined} currentVisualPath={undefined}/>);
 expect(screen.getByRole('button',{name:`预览${label}候选 01`})).toBeTruthy();
 fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));
 expect(screen.getByRole('button',{name:'移除候选'})).toBeTruthy();
 expect(screen.queryByRole('dialog')).toBeNull();
});

it('preserves the saved video in-point by default and confirms subtitle impact before replacing',async()=>{
 const video={...candidate,id:'video',kind:'video',usage:'video',relativePath:'next.mp4',durationSeconds:5,currentDurationSeconds:2};
 const current={...workspace,visualCandidates:[video]} as ProductionWorkspace;
 const project={timelines:[{fps:30,items:[{id:'visual-1',kind:'video',srcInFrame:30}]}]} as unknown as import('../worker/openchatcutProject').OpenChatCutProject;
 const preview={...plan,candidateId:'video',impact:{...plan.impact,captionRecheck:true,appliedSeconds:2,deltaSeconds:0,affectedFragments:[]}};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:current})));
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?preview:current);
 render(<WorkspaceVisualCandidatesPanel preparation workspace={current} command={command} onChange={()=>{}} materials={[]} project={project} currentVisualKind="video" currentVisualPath="used.mp4"/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));
 fireEvent.click(screen.getByRole('button',{name:'预览视频候选 02'}));
 fireEvent.click(screen.getByRole('button',{name:'采用到当前镜头'}));
 expect(await screen.findByRole('dialog',{name:'采用前核对'})).toBeTruthy();
 expect(screen.getByText('采用后需要重新核对本镜头字幕时序。')).toBeTruthy();
 expect(command).toHaveBeenCalledExactlyOnceWith('prepareWorkspaceVisualCandidate',expect.objectContaining({durationPolicy:'keep-target',sourceInSeconds:1,sourceOutSeconds:5,motionPolicy:'preserve-target'}));
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(command).toHaveBeenCalledTimes(1);
});
