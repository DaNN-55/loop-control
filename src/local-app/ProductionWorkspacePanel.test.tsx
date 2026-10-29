import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
const workspace={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',storyboardPackageId:'b',revision:1,contentSha256:'a'.repeat(64),clips:[{id:'clip',itemId:'shot-S01-clip',shotId:'S01',text:'第一镜',source:null}],project:{relativePath:'episodes/e/project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'loop-control-e'},readiness:{deliverable:false,placeholders:['shot-S01-clip'],missingSources:[]},stale:false} as const;
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('four-step navigation reads durable state and does not submit approvals or generation',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn();render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" boardId="b" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByRole('button',{name:'素材准备与匹配'});fireEvent.click(screen.getByRole('button',{name:'检查与交付'}));expect(screen.getByText('还有 1 处占位')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'脚本确认'}));expect(command).not.toHaveBeenCalled();
});
it('enables a persisted draft only after the explicit Owner action',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({workspace:null}),{status:200,headers:{'Content-Type':'application/json'}})));
 const command=vi.fn(async()=>workspace);render(<ProductionWorkspacePanel episodeId="e" title="工程" scriptRevisionId="s" boardId="b" materials={[]} command={command} onLegacy={()=>{}}/>);
 await waitFor(()=>expect((screen.getByRole('button',{name:'启用四步制作'}) as HTMLButtonElement).disabled).toBe(false));expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'启用四步制作'}));await screen.findByText('第一镜');expect(command).toHaveBeenCalledWith('prepareWorkspace',{episodeId:'e',reviewPackageId:'b',expectedScriptRevisionId:'s'});
});
