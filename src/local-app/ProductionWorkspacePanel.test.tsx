import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
const workspace={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',storyboardPackageId:'b',revision:1,contentSha256:'a'.repeat(64),clips:[{id:'clip',itemId:'shot-S01-clip',shotId:'S01',text:'第一镜',source:null}],project:{relativePath:'episodes/e/project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'loop-control-e'},readiness:{deliverable:false,placeholders:['shot-S01-clip'],missingSources:[]},stale:false} as const;
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('four-step navigation reads durable state and does not submit approvals or generation',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn();render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" boardId="b" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByRole('button',{name:'素材准备与匹配'});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'检查与交付'}));});expect(screen.getByText('还有 1 处占位')).toBeTruthy();await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'脚本确认'}));});expect(command).not.toHaveBeenCalled();
});
it('enables a persisted draft only after the explicit Owner action',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn(async()=>workspace);render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" boardId="b" materials={[]} command={command} onLegacy={()=>{}}/>);
 await waitFor(()=>expect((screen.getByRole('button',{name:'准备素材匹配'}) as HTMLButtonElement).disabled).toBe(false));expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'准备素材匹配'}));await screen.findByText('第一镜');expect(command).toHaveBeenCalledWith('prepareWorkspace',{episodeId:'e',reviewPackageId:'b',expectedScriptRevisionId:'s'});
});
it('shows the four-step shell on a new episode without mounting old workflow actions',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn();render(<ProductionWorkspacePanel episodeId="fresh" title="新单" stage="waiting_input" scriptRevisionId={null} materials={[]} command={command} onLegacy={()=>{}}><button>旧分镜批准</button></ProductionWorkspacePanel>);
 await screen.findByRole('navigation',{name:'四步制作步骤'});expect(screen.getByRole('textbox',{name:'主脚本'})).toBeTruthy();expect(screen.queryByRole('button',{name:'旧分镜批准'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'素材准备与匹配'}));expect(command).not.toHaveBeenCalled();expect(screen.getByText('请先确认脚本。')).toBeTruthy();
});
it('keeps an unsaved script draft while navigating read-only steps',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 render(<ProductionWorkspacePanel episodeId="fresh" title="新单" stage="waiting_input" scriptRevisionId={null} materials={[]} command={vi.fn()} onLegacy={()=>{}}/>);
 await screen.findByRole('textbox',{name:'主脚本'});fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'未提交的脚本草稿'}});fireEvent.click(screen.getByRole('button',{name:'素材准备与匹配'}));fireEvent.click(screen.getByRole('button',{name:'脚本确认'}));expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe('未提交的脚本草稿');
});
it('requires an explicit recovery choice before replacing a legacy working edit',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn().mockRejectedValueOnce(Error('发现旧剪辑工作版本，请明确保留或封存。')).mockResolvedValue(workspace);
 render(<ProductionWorkspacePanel episodeId="e" title="工程" stage="script_approved" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await waitFor(()=>expect((screen.getByRole('button',{name:'准备素材匹配'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'准备素材匹配'}));await screen.findByRole('region',{name:'旧剪辑工作版本处理'});expect(command).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'保留旧编辑并继续'}));await screen.findByText('第一镜');expect(command).toHaveBeenLastCalledWith('prepareWorkspace',{episodeId:'e',expectedScriptRevisionId:'s',legacyDecision:'preserve'});
});
it('shows planner failure and retries only through the explicit failed-task action',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn().mockResolvedValueOnce({planning:true,taskId:'failed-task',status:'failed',detail:'规划执行失败'}).mockResolvedValueOnce({planning:true,taskId:'retry-task',status:'ready'});
 render(<ProductionWorkspacePanel episodeId="e" title="工程" stage="script_approved" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await waitFor(()=>expect((screen.getByRole('button',{name:'准备素材匹配'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'准备素材匹配'}));await screen.findByRole('button',{name:'重试素材规划'});expect(screen.getByRole('alert').textContent).toContain('规划执行失败');expect(command).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'重试素材规划'}));await screen.findByRole('button',{name:'刷新规划结果'});expect(command).toHaveBeenLastCalledWith('retryWorkspacePlanning',{episodeId:'e',expectedScriptRevisionId:'s',taskId:'failed-task'});
});
