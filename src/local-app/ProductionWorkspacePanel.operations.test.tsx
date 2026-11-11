import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import {WorkspaceNavigationContext} from './catalogNavigation';
import type {ProductionStep} from '../episodes/episodeCatalogTypes';
const workspace={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:1,contentSha256:'a'.repeat(64),clips:[{id:'clip',itemId:'item',shotId:'S01',text:'第一镜',source:null}],project:{relativePath:'project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'loop-control-e'},readiness:{deliverable:false,placeholders:[],missingSources:[]},stale:false};
const studio={projectId:'loop-control-e',relativePath:'work/project.json',sha256:'b'.repeat(64),fileSize:2};
const opened={studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace:studio,productionWorkspace:workspace};
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function readWorkspace(){vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));}
it('offers only a read to check an unknown Studio operation result without replaying it',async()=>{
 let reads=0;const fetcher=vi.fn(async(path:string)=>Response.json(path==='/api/local/connections'?{serviceCatalog:{version:1,groups:[]}}:{workspace:path.endsWith('/workspace')&&++reads>1?{...workspace,revision:2,clips:[{...workspace.clips[0],text:'已保存的最新镜头'}]}:workspace}));vi.stubGlobal('fetch',fetcher);
 const command=vi.fn(async()=>{throw Object.assign(Error('本机操作结果暂未确认，请查看系统状态并核对已有任务或保存结果，再继续操作。'),{status:503,code:'LOCAL_COMMAND_OUTCOME_UNKNOWN'});});
 render(<ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'进入剪辑工作台'}));await screen.findByText('打开剪辑工作台结果暂未确认');
 expect(command).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'重新读取已保存工程'}));
 await screen.findByText('已保存的最新镜头');expect(reads).toBe(2);expect(command).toHaveBeenCalledTimes(1);
 expect(screen.getByText('打开剪辑工作台结果暂未确认').closest('[role="alert"]')?.textContent).toContain('原操作是否完成仍未确认');expect(screen.queryByTitle('OpenChatCut 剪辑工程')).toBeNull();
});
it('does not automatically prepare again when checking an unknown preparation result without a workspace',async()=>{
 const fetcher=vi.fn(async()=>Response.json({workspace:null}));vi.stubGlobal('fetch',fetcher);
 const command=vi.fn(async()=>{throw Object.assign(Error('结果暂未确认'),{code:'local_service_unavailable'});});
 render(<ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('准备分镜工程结果暂未确认');fireEvent.click(screen.getByRole('button',{name:'重新读取已保存工程'}));
 await screen.findByText('已重新读取当前工程，原操作是否完成仍未确认。请核对已有任务和保存结果。');
 expect(command).toHaveBeenCalledExactlyOnceWith('prepareWorkspace',{episodeId:'e',expectedScriptRevisionId:'s'});expect(fetcher).toHaveBeenCalledTimes(2);
});
it('keeps the unknown result when a check fails and permits a read-only retry',async()=>{
 let reads=0;vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/workspace')&&++reads===2?Response.json({}, {status:503}):Response.json({workspace})));
 const command=vi.fn(async()=>{throw Object.assign(Error('结果暂未确认'),{code:'local_service_unavailable'});});
 render(<ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'进入剪辑工作台'}));await screen.findByText('打开剪辑工作台结果暂未确认');
 fireEvent.click(screen.getByRole('button',{name:'重新读取已保存工程'}));await screen.findByText('无法读取当前工程版本。');
 fireEvent.click(screen.getByRole('button',{name:'重新读取已保存工程'}));await screen.findByText('已重新读取当前工程，原操作是否完成仍未确认。请核对已有任务和保存结果。');expect(command).toHaveBeenCalledTimes(1);expect(reads).toBe(3);
});
it('does not attach a delayed check failure to the next unknown operation',async()=>{
 let reads=0,failRead!:(cause:Error)=>void;vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/workspace')&&++reads===2)return new Promise<Response>((_resolve,reject)=>{failRead=reject;});
  return Response.json({workspace});
 }));
 const command=vi.fn(async()=>{throw Object.assign(Error('结果暂未确认'),{code:'local_service_unavailable'});});
 render(<ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'进入剪辑工作台'}));await screen.findByText('打开剪辑工作台结果暂未确认');
 fireEvent.click(screen.getByRole('button',{name:'重新读取已保存工程'}));await screen.findByRole('button',{name:'读取中…'});
 fireEvent.click(screen.getByRole('button',{name:'进入剪辑工作台'}));await screen.findByText('打开剪辑工作台结果暂未确认');
 await act(async()=>failRead(Error('旧核对读取失败')));expect(screen.queryByText('旧核对读取失败')).toBeNull();expect(screen.queryByText('Workspace reading ended.')).toBeNull();expect(command).toHaveBeenCalledTimes(2);
 expect(screen.getByRole('button',{name:'重新读取已保存工程'}).hasAttribute('disabled')).toBe(false);
});
it('keeps browser navigation after a delayed Studio open succeeds',async()=>{
 readWorkspace();let finish!:(value:unknown)=>void;const command=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const view=(step:ProductionStep)=><WorkspaceNavigationContext.Provider value={{episode:'e',step,tab:'visual',change:()=>{}}}><ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/></WorkspaceNavigationContext.Provider>;
 const app=render(view('editing'));fireEvent.click(await screen.findByRole('button',{name:'重试打开剪辑工作台'}));app.rerender(view('delivery'));await screen.findByRole('button',{name:'检查与交付，当前查看'});
 await act(async()=>finish(opened));expect(screen.getByRole('button',{name:'检查与交付，当前查看'})).toBeTruthy();expect(screen.queryByTitle('OpenChatCut 剪辑工程')).toBeNull();
});
it('does not present an old opening failure after browser navigation',async()=>{
 readWorkspace();let fail!:(value:unknown)=>void;const command=vi.fn(()=>new Promise((_resolve,reject)=>{fail=reject;}));
 const view=(step:ProductionStep)=><WorkspaceNavigationContext.Provider value={{episode:'e',step,tab:'visual',change:()=>{}}}><ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/></WorkspaceNavigationContext.Provider>;
 const app=render(view('editing'));fireEvent.click(await screen.findByRole('button',{name:'重试打开剪辑工作台'}));app.rerender(view('delivery'));await act(async()=>fail(Error('旧打开失败')));expect(screen.queryByText('旧打开失败')).toBeNull();expect(screen.getByRole('button',{name:'检查与交付，当前查看'})).toBeTruthy();
});
it('shares one synchronous opening guard with the external Studio action',async()=>{
 readWorkspace();let open:(()=>void)|null=null,finish!:(value:unknown)=>void;
 const command=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));render(<ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}} onStudioActionChange={action=>{open=action;}}/>);await screen.findByText('第一镜');
 act(()=>{open?.();open?.();});expect(command).toHaveBeenCalledTimes(1);await act(async()=>finish(opened));expect(await screen.findByTitle('OpenChatCut 剪辑工程')).toBeTruthy();
});
async function enterStudio(command:(name:string,data:unknown)=>Promise<unknown>){
 readWorkspace();const app=render(<ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'进入剪辑工作台'}));const frame=await screen.findByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement;
 const url=new URL(frame.src),channel=url.searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:url.origin,source:frame.contentWindow!,data:{channel,projectId:'loop-control-e',...data}}));
 deliver({type:'loop-control:state',writable:true,revision:1,items:[{id:'item',startFrame:0,durationInFrames:60}],selectedIds:['item'],shots:[{id:'S01',text:'第一镜',itemIds:['item']}]});
 for(const[message]of post.mock.calls)deliver({type:'loop-control:result',requestId:message.requestId,ok:true});
 function flush(button='保存'){fireEvent.click(screen.getByRole('button',{name:button}));const request=post.mock.calls.at(-1)![0];expect(request.action).toBe('flush');deliver({type:'loop-control:result',requestId:request.requestId,ok:true});}
 return{...app,frame,flush};
}
it('keeps the same real host after save fails and closes only after a successful save with the newest revision',async()=>{
 let saves=0;const command=vi.fn(async(name:string,_data:unknown)=>{if(name==='openWorkspaceStudio')return opened;if(name==='saveWorkspaceStudio'){if(++saves===1)throw Error('保存失败，修改保留');return{...studio,sha256:'c'.repeat(64),productionWorkspace:{...workspace,revision:2}};}return{...workspace,revision:3};});
 const{frame,flush}=await enterStudio(command);flush();await screen.findAllByText('保存失败，修改保留');expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);expect(command.mock.calls.map(([name])=>name)).toEqual(['openWorkspaceStudio','saveWorkspaceStudio']);
 flush('保存并返回分镜台');await screen.findByRole('button',{name:'进入剪辑工作台'});expect(screen.queryByTitle('OpenChatCut 剪辑工程')).toBeNull();expect(command).toHaveBeenLastCalledWith('closeWorkspaceStudio',{episodeId:'e',workspaceId:'w',expectedRevision:2});expect(command.mock.calls[2]).toEqual(['saveWorkspaceStudio',{episodeId:'e',workspaceId:'w',expectedRevision:1,workspaceRelativePath:studio.relativePath,projectId:studio.projectId,expectedWorkspaceSha256:studio.sha256}]);
 expect(screen.getByRole('row',{name:'镜头 01'}).getAttribute('aria-selected')).toBe('true');
});
it('retains the editor and saved file identity after close fails, then retries the existing save/close path',async()=>{
 let closes=0,saves=0;const command=vi.fn(async(name:string,_data:unknown)=>{if(name==='openWorkspaceStudio')return opened;if(name==='saveWorkspaceStudio')return{...studio,sha256:'c'.repeat(64),productionWorkspace:{...workspace,revision:++saves+1}};if(++closes===1)throw Error('关闭失败，工程保留');return{...workspace,revision:4};});
 const{frame,flush}=await enterStudio(command);flush();await screen.findAllByText('关闭失败，工程保留');expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);
 flush();await screen.findByRole('button',{name:'检查与交付，当前查看'});expect(screen.queryByTitle('OpenChatCut 剪辑工程')).toBeNull();expect(command.mock.calls[3]).toEqual(['saveWorkspaceStudio',{episodeId:'e',workspaceId:'w',expectedRevision:2,workspaceRelativePath:studio.relativePath,projectId:studio.projectId,expectedWorkspaceSha256:'c'.repeat(64)}]);expect(command.mock.calls[4]).toEqual(['closeWorkspaceStudio',{episodeId:'e',workspaceId:'w',expectedRevision:3}]);
});
it('keeps an explicit viewing step on refresh without opening the saved native project',async()=>{
 readWorkspace();const command=vi.fn(),panel=<WorkspaceNavigationContext.Provider value={{episode:'e',step:'editing',tab:'visual',change:()=>{}}}><ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/></WorkspaceNavigationContext.Provider>;
 const first=render(panel);await screen.findByRole('button',{name:'重试打开剪辑工作台'});first.unmount();render(panel);await screen.findByRole('button',{name:'重试打开剪辑工作台'});expect(command).not.toHaveBeenCalled();
});
it('ignores a pending open result if the current episode becomes read-only',async()=>{
 readWorkspace();let finish!:(value:unknown)=>void;const command=vi.fn(()=>new Promise(resolve=>{finish=resolve;})),props={episodeId:'e',title:'操作转换',scriptRevisionId:'s',materials:[],command,onLegacy:()=>{}};
 const app=render(<ProductionWorkspacePanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'进入剪辑工作台'}));app.rerender(<ProductionWorkspacePanel {...props} historicalReadOnly/>);await act(async()=>finish(opened));expect(screen.queryByTitle('OpenChatCut 剪辑工程')).toBeNull();expect(command).toHaveBeenCalledTimes(1);
});
it('retains the in-flight lock after navigation and uses the completed open revision on the next explicit open',async()=>{
 readWorkspace();let finish!:(value:unknown)=>void,open:(()=>void)|null=null;let calls=0;
 const command=vi.fn(async()=>++calls===1?await new Promise(resolve=>{finish=resolve;}):{...opened,productionWorkspace:{...workspace,revision:2}});
 const view=(step:ProductionStep)=><WorkspaceNavigationContext.Provider value={{episode:'e',step,tab:'visual',change:()=>{}}}><ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}} onStudioActionChange={action=>{open=action;}}/></WorkspaceNavigationContext.Provider>;
 const app=render(view('editing'));fireEvent.click(await screen.findByRole('button',{name:'重试打开剪辑工作台'}));app.rerender(view('delivery'));await screen.findByRole('button',{name:'检查与交付，当前查看'});act(()=>open?.());expect(command).toHaveBeenCalledTimes(1);
 await act(async()=>finish({...opened,productionWorkspace:{...workspace,revision:2}}));expect(screen.queryByTitle('OpenChatCut 剪辑工程')).toBeNull();act(()=>open?.());await screen.findByTitle('OpenChatCut 剪辑工程');expect(command).toHaveBeenLastCalledWith('openWorkspaceStudio',{episodeId:'e',workspaceId:'w',expectedRevision:2});
});
it('recovers the authoritative revision after a cancelled open fails without replaying it',async()=>{
 let reads=0;vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json({workspace:path.endsWith('/workspace')&&++reads>1?{...workspace,revision:2}:workspace})));let fail!:(value:unknown)=>void;
 const command=vi.fn(()=>new Promise((_resolve,reject)=>{fail=reject;}));const view=(step:ProductionStep)=><WorkspaceNavigationContext.Provider value={{episode:'e',step,tab:'visual',change:()=>{}}}><ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/></WorkspaceNavigationContext.Provider>;
 const app=render(view('editing'));fireEvent.click(await screen.findByRole('button',{name:'重试打开剪辑工作台'}));app.rerender(view('delivery'));await act(async()=>fail(Error('响应丢失')));await screen.findByText('先导出最终视频，检查后确认这份文件。');expect(reads).toBe(2);expect(command).toHaveBeenCalledTimes(1);expect(screen.queryByText('响应丢失')).toBeNull();expect(screen.getByRole('button',{name:'检查与交付，当前查看'})).toBeTruthy();
});
it('retries preparation explicitly after failure and does not add another automatic attempt',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:null})));let prepares=0;const command=vi.fn(async()=>{if(++prepares===1)throw Error('准备失败');return workspace;});
 render(<ProductionWorkspacePanel episodeId="e" title="操作转换" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);await screen.findByRole('button',{name:'重试'});expect(command).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'重试'}));await screen.findByText('第一镜');expect(command).toHaveBeenCalledTimes(2);expect(command).toHaveBeenLastCalledWith('prepareWorkspace',{episodeId:'e',expectedScriptRevisionId:'s'});
});

it.each([1,2,3])('orders an open receipt against a delayed workspace reload at revision %s',async revision=>{
 let reads=0,finishRead!:(value:Response)=>void,finishOpen!:(value:unknown)=>void;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/workspace')&&++reads===2)return new Promise<Response>(resolve=>{finishRead=resolve;});
  return Response.json({workspace});
 }));
 const command=vi.fn(()=>new Promise(resolve=>{finishOpen=resolve;}));
 const view=(step:ProductionStep,boardId='board')=><WorkspaceNavigationContext.Provider value={{episode:'e',step,tab:'visual',change:()=>{}}}><ProductionWorkspacePanel episodeId="e" title="读取顺序" scriptRevisionId="s" boardId={boardId} materials={[]} command={command} onLegacy={()=>{}}/></WorkspaceNavigationContext.Provider>;
 const app=render(view('editing'));
 fireEvent.click(await screen.findByRole('button',{name:'重试打开剪辑工作台'}));
 app.rerender(view('preparation','new-board'));
 const latest={...workspace,revision:2,clips:[{...workspace.clips[0],text:'已接收的新镜头'}]};
 await act(async()=>finishOpen({...opened,productionWorkspace:latest}));
 await act(async()=>finishRead(Response.json({workspace:{...workspace,revision}})));
 expect(await screen.findByText(revision>2?'第一镜':'已接收的新镜头')).toBeTruthy();
 expect(screen.queryByTitle('OpenChatCut 剪辑工程')).toBeNull();
 expect(command).toHaveBeenCalledTimes(1);
});

it('accepts a replacement workspace when a reload has no intervening command receipt',async()=>{
 let reads=0;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json({workspace:path.endsWith('/workspace')&&++reads>1?{...workspace,id:'replacement',revision:1,clips:[{...workspace.clips[0],text:'新工作版本'}]}:workspace})));
 const command=vi.fn(),view=(boardId:string)=><ProductionWorkspacePanel episodeId="e" title="版本读取" scriptRevisionId="s" boardId={boardId} materials={[]} command={command} onLegacy={()=>{}}/>;
 const app=render(view('board'));await screen.findByText('第一镜');
 app.rerender(view('new-board'));expect(await screen.findByText('新工作版本')).toBeTruthy();
 expect(command).not.toHaveBeenCalled();
});
