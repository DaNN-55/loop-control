import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
const project={timelines:[{id:'t',fps:30,items:[{id:'visual',kind:'image',startFrame:0,durationInFrames:150}]}]} as unknown as OpenChatCutProject;
const workspace={id:'w',episodeId:'e',revision:1,project:{sha256:'original'},clips:[{id:'clip',itemId:'visual',shotId:'S1',text:'咖啡'}],visualCandidates:[{id:'short',kind:'video',usage:'video',targetItemId:'visual',shotId:'S1',status:'available',relativePath:'short.mp4',sha256:'a'.repeat(64),durationSeconds:3,currentDurationSeconds:5}]} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('prefills generation from the actual five-second shot instead of an unrelated three-second default',()=>{
 render(<WorkspaceVisualPreparation workspace={workspace} project={project} materials={[]} command={vi.fn()} onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));fireEvent.click(screen.getByRole('button',{name:'生成时长'}));
 expect((screen.getByLabelText('生成时长（秒）') as HTMLInputElement).value).toBe('5');
});
it('explains a short candidate next to adoption and exposes a direct duration action',()=>{
 const command=vi.fn();render(<WorkspaceVisualPreparation workspace={workspace} project={project} materials={[]} command={command} onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'预览视频候选 01'}));
 expect(screen.getByText('素材可用 3.00 秒，短于当前镜头 5.00 秒。')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'调整采用时长'}));
 expect(screen.getByLabelText('视觉候选时长处理').closest('[role=dialog]')).toBeTruthy();expect(command).not.toHaveBeenCalled();
});
