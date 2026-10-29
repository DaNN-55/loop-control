import {act,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {LocalSystemStatus} from './LocalSystemStatus';
import {localRequest} from './client';
import {healthCheckLabels,type HealthCheck} from '../observability/healthChecks';
vi.mock('./client',()=>({localRequest:vi.fn()}));
const at='2026-10-29T10:00:00Z';
function fixture(){return {observedAt:at,automation:{stopped:false,lastError:null,lastScanAt:at,backupsEnabled:false},plans:[],jobs:[],maintenanceAvailable:true,
 operations:{schedule:{latest:{at,passed:true,detail:'调度正常'}},notification:{latest:{at,passed:true,detail:'提醒正常'}},health:{latest:{at,passed:true,detail:'健康检查通过'}},backup:{latest:{at,passed:false,detail:'旧备份失败'}}},
 runtime:{observedAt:at,worker:{state:'healthy',heartbeatAt:at,lastScanAt:at,active:1,capacity:2,problem:null},resources:{cpuPercent:22,memory:{totalBytes:32*1024**3,freeBytes:8*1024**3},disk:{availableBytes:100*1024**3,totalBytes:500*1024**3},media:{state:'healthy',availableBytes:50*1024**3,minimumFreeBytes:1024**3}},queue:{running:1,queued:2,blocked:0,failed:0,total:3,page:1,pageSize:20,items:[{id:'a',episodeId:'episode-a',episodeTitle:'真实生产单 A',taskType:'generate_narration',status:'running',createdAt:at,claimedAt:at,availableAt:null},{id:'b',episodeId:'episode-b',episodeTitle:'真实生产单 B',taskType:'generate_b_roll',status:'ready',createdAt:at,claimedAt:null,availableAt:null},{id:'c',episodeId:'episode-c',episodeTitle:'真实生产单 C',taskType:'generate_a_roll',status:'ready',createdAt:at,claimedAt:null,availableAt:null}]}}};}
beforeEach(()=>vi.mocked(localRequest).mockReset().mockResolvedValue(fixture()));
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('从真实摘要打开抽屉，队列默认两项；维护关闭项不报故障，Esc 返回原入口',async()=>{
 const user=userEvent.setup();render(<LocalSystemStatus onOpenEpisode={()=>true}/>);
 const trigger=await screen.findByRole('button',{name:'系统状态：正常'});await user.click(trigger);
 const dialog=screen.getByRole('dialog',{name:'系统状态详情'});
 expect(within(dialog).getAllByRole('button',{name:/查看生产单/})).toHaveLength(2);
 await user.click(within(dialog).getByRole('button',{name:'展开全部 3 项'}));
 expect(within(dialog).getAllByRole('button',{name:/查看生产单/})).toHaveLength(3);
 await user.click(within(dialog).getByText('日常维护',{exact:true}));
 const backup=within(dialog).getByText('完整备份').closest('details')!;
 expect(backup.textContent).toContain('已关闭');expect(backup.querySelector('.status-drawer-warning')).toBeNull();
 expect(screen.queryByText('旧备份失败')).toBeNull();
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);
});
it('缺少 Worker 观测时不把存在运行任务当作在线证明',async()=>{
 const value=fixture();Object.assign(value.runtime,{worker:{state:'unknown',heartbeatAt:null,lastScanAt:null,active:null,capacity:null,problem:'本机 Worker 未配置。'}});
 vi.mocked(localRequest).mockResolvedValue(value);const user=userEvent.setup();render(<LocalSystemStatus/>);
 await user.click(await screen.findByRole('button',{name:'系统状态：待确认'}));
 expect(screen.getByText('未配置',{exact:true})).toBeTruthy();expect(screen.queryByText(/在线 ·/)).toBeNull();
});
it('读取失败清除旧的正常状态；重试成功恢复真实指标',async()=>{
 const user=userEvent.setup();render(<LocalSystemStatus/>);await user.click(await screen.findByRole('button',{name:'系统状态：正常'}));
 vi.mocked(localRequest).mockRejectedValueOnce(new Error('状态读取失败。'));
 await user.click(screen.getByRole('button',{name:'刷新系统状态'}));
 expect((await screen.findByRole('alert')).textContent).toContain('状态读取失败');
 expect(screen.getByRole('button',{name:'系统状态：不可用'})).toBeTruthy();expect(screen.queryByText('真实生产单 A')).toBeNull();
 await user.click(screen.getByRole('button',{name:'刷新系统状态'}));await screen.findByText('真实生产单 A');expect(screen.queryByRole('alert')).toBeNull();
});
it('首次读取期间打开不重复请求；卸载后的迟到结果不能覆盖新读取',async()=>{
 let finish!:(value:unknown)=>void;
 vi.mocked(localRequest).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
 const user=userEvent.setup(),first=render(<LocalSystemStatus/>);await user.click(screen.getByRole('button',{name:/系统状态/}));
 expect(localRequest).toHaveBeenCalledTimes(1);expect((screen.getByRole('button',{name:'读取中…'}) as HTMLButtonElement).disabled).toBe(true);
 first.unmount();render(<LocalSystemStatus/>);await screen.findByRole('button',{name:'系统状态：正常'});
 await act(async()=>finish({}));expect(screen.getByRole('button',{name:'系统状态：正常'})).toBeTruthy();
});
it('只在抽屉打开且页面可见时轮询，关闭后停止',async()=>{
 vi.useFakeTimers();render(<LocalSystemStatus/>);await act(async()=>{});
 fireEvent.click(screen.getByRole('button',{name:'系统状态：正常'}));await act(async()=>{});
 const initial=vi.mocked(localRequest).mock.calls.length;
 await act(async()=>{vi.advanceTimersByTime(5000);});expect(localRequest).toHaveBeenCalledTimes(initial+1);
 vi.spyOn(document,'hidden','get').mockReturnValue(true);
 await act(async()=>{vi.advanceTimersByTime(10000);});expect(localRequest).toHaveBeenCalledTimes(initial+1);
 fireEvent.click(screen.getByRole('button',{name:'关闭系统状态详情'}));
 await act(async()=>{vi.advanceTimersByTime(10000);});expect(localRequest).toHaveBeenCalledTimes(initial+1);
});
it('分页只读取有界服务端页，生产单导航取消时保留抽屉',async()=>{
 const value=fixture();value.runtime.queue.total=25;
 vi.mocked(localRequest).mockResolvedValue(value);const user=userEvent.setup(),onOpenEpisode=vi.fn(()=>false);
 render(<LocalSystemStatus onOpenEpisode={onOpenEpisode}/>);await user.click(await screen.findByRole('button',{name:'系统状态：正常'}));
 await user.click(screen.getByRole('button',{name:'展开本页 3 项'}));await user.click(screen.getByRole('button',{name:'下一页'}));
 await waitFor(()=>expect(localRequest).toHaveBeenCalledWith('system-status?queuePage=2',expect.objectContaining({signal:expect.any(AbortSignal)})));
 await user.click(screen.getByRole('button',{name:'查看生产单：真实生产单 A'}));expect(onOpenEpisode).toHaveBeenCalledWith('episode-a');expect(screen.getByRole('dialog')).toBeTruthy();
});
it('子区域读取失败保持未知，Worker 离线时自动展开；关闭备份不掩盖真实故障',async()=>{
 const value=fixture();Object.assign(value.runtime,{queue:null,resources:null,worker:{state:'offline',heartbeatAt:at,lastScanAt:at,active:0,capacity:1,problem:'Worker 心跳已中断，请检查本机服务。'}});
 vi.mocked(localRequest).mockResolvedValue(value);const user=userEvent.setup();render(<LocalSystemStatus/>);
 await user.click(await screen.findByRole('button',{name:'系统状态：需处理'}));
 expect(await screen.findByText('Worker 心跳已中断，请检查本机服务。')).toBeTruthy();
 expect(screen.getByText('任务队列尚未读取或暂不可用，请刷新重试。')).toBeTruthy();
 expect(screen.getAllByText('未读取',{exact:true}).length).toBeGreaterThan(1);
});
it('健康分项默认折叠，异常摘要精简，展开后保留成功项与明确失败原因',async()=>{
 const value=fixture();Object.assign(value.operations.health.latest,{passed:false,detail:'1 项检查失败。',checks:(Object.keys(healthCheckLabels) as HealthCheck['id'][]).map(id=>({id,passed:id!=='runtime',detail:id==='runtime'?'运行程序已过期，请准备后重启。':'检查通过。'}))});
 vi.mocked(localRequest).mockResolvedValue(value);const user=userEvent.setup();render(<LocalSystemStatus/>);
 const trigger=await screen.findByRole('button',{name:'系统状态：需处理'});expect(trigger.classList.contains('system-status-attention')).toBe(true);await user.click(trigger);
 const maintenance=screen.getByText('日常维护',{exact:true}).closest('details')!;
 const health=screen.getByText('每日健康检查',{exact:true}).closest('details')!;
 expect(maintenance.open).toBe(false);expect(health.open).toBe(false);
 await user.click(within(maintenance).getByText('日常维护',{exact:true}));expect(within(health).getByText('1 项异常')).toBeTruthy();
 await user.click(within(health).getByText('每日健康检查'));expect(health.open).toBe(true);
 expect(within(health).getAllByText('通过',{exact:true})).toHaveLength(2);expect(within(health).getByText('运行程序已过期，请准备后重启。')).toBeTruthy();expect(within(health).queryByText('检查通过。')).toBeNull();
});
it('成功后的最近失败分项单独展开；历史无分项记录保留原原因',async()=>{
 const value=fixture();const checks=(Object.keys(healthCheckLabels) as HealthCheck['id'][]).map(id=>({id,passed:true,detail:'通过'}));
 Object.assign(value.operations.health,{latest:{at,passed:true,detail:'3 项通过',checks},lastFailure:{at,passed:false,detail:'数据库认证失败',checks:checks.map(check=>({...check,passed:check.id!=='database',detail:'数据库认证失败'}))}});
 vi.mocked(localRequest).mockResolvedValue(value);const user=userEvent.setup();render(<LocalSystemStatus/>);await user.click(await screen.findByRole('button',{name:'系统状态：正常'}));
 await user.click(screen.getByText('日常维护',{exact:true}));await user.click(screen.getByText('每日健康检查'));
 expect(screen.getByText('3 项通过',{exact:true})).toBeTruthy();const history=screen.getByText('最近失败分项').closest('details')!;expect(history.open).toBe(false);await user.click(screen.getByText('最近失败分项'));expect(history.open).toBe(true);expect(within(history).getByText('失败',{exact:true})).toBeTruthy();
});
