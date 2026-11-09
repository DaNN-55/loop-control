import userEvent from '@testing-library/user-event';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import {WorkspacePexelsSearch} from './WorkspacePexelsSearch';
import {useWorkspaceReading} from './useWorkspaceReading';
import type {ProductionWorkspace} from '../productionWorkspace';
const workspace={project:{sha256:'original'},id:'workspace',episodeId:'episode',revision:3,stale:false,clips:[{id:'clip',itemId:'visual',shotId:'S1',text:'画面'}],visualCandidates:[]} as unknown as ProductionWorkspace;
const service={id:'pexels',provider:'pexels',adapter:'pexels_video',mode:'search',models:[],presets:['b-roll-v1'],connectionVersionId:'version',connectionName:'Pexels A',executable:true,constraints:{query:{maxLength:100}}};
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('keeps the Pexels submit state consistent with the refreshed parent catalog',async()=>{
 let enabled=true;const fetcher=vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'video',services:[{...service,executable:enabled,unavailableReason:enabled?null:'连接已撤销。'}]}]}}));vi.stubGlobal('fetch',fetcher);const command=vi.fn();
 render(<WorkspaceVisualPreparation workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));
 await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));await userEvent.click(await screen.findByRole('menuitemradio',{name:/^Pexels 素材检索/}));
 fireEvent.change(screen.getByRole('textbox',{name:'检索词'}),{target:{value:'ocean'}});await waitFor(()=>expect(screen.getByRole('button',{name:'检索视频'})).toHaveProperty('disabled',false));
 await act(async()=>{});const before=fetcher.mock.calls.length;expect(before).toBeGreaterThanOrEqual(2);
 enabled=false;fireEvent.focus(window);await waitFor(()=>expect(fetcher.mock.calls.length).toBe(before+1));await act(async()=>{});
 // Display and submit must use the same availability snapshot.
 await waitFor(()=>expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain('选择视频模型'));
 await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));await screen.findByText('暂无可用视频模型。');expect(screen.queryByRole('menuitemradio',{name:/^Pexels 素材检索/})).toBeNull();await userEvent.click(screen.getByRole('button',{name:'关闭模型选择'}));expect(screen.getByRole('button',{name:'检索视频'})).toHaveProperty('disabled',true);expect(command).not.toHaveBeenCalled();
});
it('routes a catalog 401 through the existing session-expired event',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'会话已失效'},{status:401})));const expired=vi.fn();window.addEventListener('loop-local-session-expired',expired);
 function Host(){const reader=useWorkspaceReading(workspace,()=>{},'visual','读取失败');return <WorkspacePexelsSearch workspace={workspace} targetItemId="visual" command={vi.fn()} onChange={()=>{}} prepare={async()=>workspace} reader={reader}/>;}
 try{render(<Host/>);await waitFor(()=>expect(expired).toHaveBeenCalledOnce());expect(screen.queryByText('无法读取 Pexels 连接。')).toBeNull();}finally{window.removeEventListener('loop-local-session-expired',expired);}
});
it('keeps the previous display and query draft when malformed catalog groups arrive',async()=>{
 let malformed=false;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:malformed?[null]:[{capability:'video',services:[service]}]}})));
 const command=vi.fn();render(<WorkspaceVisualPreparation workspace={workspace} command={command} onChange={()=>{}} materials={[]}/>);
 fireEvent.click(screen.getByRole('tab',{name:'视频'}));fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await userEvent.click(screen.getByRole('button',{name:'视频连接与模型'}));await userEvent.click(await screen.findByRole('menuitemradio',{name:/^Pexels 素材检索/}));
 fireEvent.change(screen.getByRole('textbox',{name:'检索词'}),{target:{value:'保留查询'}});malformed=true;fireEvent.focus(window);
 await screen.findByRole('button',{name:'重试读取连接'});expect(screen.getByRole('textbox',{name:'检索词'})).toHaveProperty('value','保留查询');expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain('Pexels 素材检索');expect(command).not.toHaveBeenCalled();
});
