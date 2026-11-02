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
const plan={adoptionId:'prepared',candidateId:'image',projectSha256:'original',edit:{},impact:{currentSeconds:2,sourceSeconds:3,appliedSeconds:3,deltaSeconds:1,startSeconds:0,endSeconds:3,fps:30,affectedFragments:[{itemId:'visual-2',label:'下一镜山谷',kind:'image',track:'visual',startSeconds:2,endSeconds:4,changedStartSeconds:2,changedEndSeconds:3}]}};
it('shows the prepared native duration and affected fragment before a second explicit adoption action',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async(name:string)=>name==='prepareWorkspaceVisualCandidate'?plan:workspace);
 render(<WorkspaceVisualCandidatesPanel preparation workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);
 fireEvent.change(screen.getByLabelText('视觉候选时长处理'),{target:{value:'use-candidate'}});fireEvent.click(screen.getByLabelText('保留其他片段位置，接受空隙或覆盖'));fireEvent.click(screen.getByRole('button',{name:'采用此图片'}));
 expect(await screen.findByRole('region',{name:'采用前核对'})).toBeTruthy();expect(screen.getByText('当前 2.00 秒 → 采用后 3.00 秒（+1.00 秒）')).toBeTruthy();expect(screen.getByText('素材区间 3.00 秒')).toBeTruthy();expect(screen.getByText('下一镜山谷')).toBeTruthy();expect(screen.getByText(/2.00–3.00 秒/)).toBeTruthy();
 expect(command).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'确认采用'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('adoptWorkspaceVisualCandidate',expect.objectContaining({adoptionId:'prepared',candidateId:'image'})));
});
it('discards a prepared adoption when the authoritative project changes before confirmation',async()=>{
 let current=workspace;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:current})));const command=vi.fn(async()=>plan);
 render(<WorkspaceVisualCandidatesPanel preparation workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);fireEvent.click(screen.getByRole('button',{name:'采用此图片'}));await screen.findByRole('region',{name:'采用前核对'});
 current={...workspace,revision:4,project:{...workspace.project,sha256:'edited'}};fireEvent.click(screen.getByRole('button',{name:'确认采用'}));expect(await screen.findByText('工程已变化，请重新核对采用影响。')).toBeTruthy();expect(command).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:'确认采用'})).toBeNull();
});
it('clears the prepared plan when the duration policy changes and does not auto-preview stale images or videos',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));const command=vi.fn(async()=>plan),props={preparation:true,workspace,command,onChange:()=>{},materials:[]};const view=render(<WorkspaceVisualCandidatesPanel {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'采用此图片'}));await screen.findByRole('region',{name:'采用前核对'});fireEvent.change(screen.getByLabelText('视觉候选时长处理'),{target:{value:'use-candidate'}});expect(screen.queryByRole('region',{name:'采用前核对'})).toBeNull();expect(command).toHaveBeenCalledTimes(1);
 view.unmount();sessionStorage.clear();render(<WorkspaceVisualCandidatesPanel {...props} workspace={{...workspace,visualCandidates:[{...workspace.visualCandidates![0],status:'stale'},{...workspace.visualCandidates![0],id:'video',kind:'video',usage:'video'}]}}/>);expect(screen.queryByRole('img',{name:/图片候选/})).toBeNull();fireEvent.click(screen.getByRole('tab',{name:'视频'}));expect(screen.queryByLabelText('视频候选预览')).toBeNull();expect(command).toHaveBeenCalledTimes(1);
});
