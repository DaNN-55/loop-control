import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SystemStatusDrawer} from './SystemStatusDrawer';
import type {RuntimeStatus,RuntimeVersionState} from '../observability/runtimeStatus';
afterEach(cleanup);
const id='a'.repeat(64),other='b'.repeat(64),at='2026-11-02T04:00:00Z';
function renderVersion(state?:RuntimeVersionState){
 const runtime={observedAt:at,worker:{state:'healthy',heartbeatAt:at,lastScanAt:at,active:0,capacity:1,problem:null},queue:{total:0,running:0,queued:0,blocked:0,failed:0,items:[],page:1,pageSize:20},resources:{cpuPercent:0,memory:{freeBytes:1,totalBytes:2},disk:{availableBytes:1,totalBytes:2},systemDisk:{availableBytes:1,totalBytes:2,sourcePath:'/Users/owner'},media:{state:'healthy',availableBytes:1,minimumFreeBytes:0}},...(state?{version:{state,backendReleaseId:id,workerReleaseId:state==='mismatch'?other:id,preparedReleaseId:state==='restart_required'?other:id,startedAt:at,checkedAt:at}}:{})} as RuntimeStatus;
 return render(<SystemStatusDrawer open onOpen={vi.fn()} onClose={vi.fn()} runtime={runtime} maintenance={[]} maintenanceAvailable pending={false} error="" observedAt={at} onRefresh={vi.fn()} onPage={vi.fn()}/>);
}
it('shows the pinned backend and worker identities, startup time and actual page mode compactly',()=>{
 renderVersion('current');const section=screen.getByText('运行版本').closest('details')!;expect(section.textContent).toContain('已应用当前版本');expect(section.textContent).toContain('启动时间');expect(section.textContent).toContain('开发热更新');expect(section.querySelectorAll(`[title="${id}"]`)).toHaveLength(2);expect(section.textContent).not.toContain(id);expect(screen.getByRole('button',{name:'系统状态：正常'})).toBeTruthy();
});
it.each(['source_changed','restart_required','preparing','not_prepared','prepared_invalid','unknown'] as const)('a pending update (%s) does not turn a healthy running service into a failure',state=>{
 renderVersion(state);expect(screen.getByRole('button',{name:'系统状态：待确认'})).toBeTruthy();expect(screen.queryByRole('button',{name:/重启服务/})).toBeNull();if(state==='restart_required'){expect(screen.getByText('新版已准备，待重启')).toBeTruthy();expect(screen.getByText('已准备版本')).toBeTruthy();}else if(state==='source_changed')expect(screen.getByText('开发改动待准备')).toBeTruthy();
});
it.each(['running_invalid','mismatch'] as const)('a real running version problem (%s) is visible and opens its details',state=>{
 renderVersion(state);expect(screen.getByRole('button',{name:'系统状态：需处理'})).toBeTruthy();expect(screen.getByText('运行版本').closest('details')!.open).toBe(true);
});
it('does not claim that an old backend without version evidence has applied the update',()=>{
 renderVersion();expect(screen.getByRole('button',{name:'系统状态：待确认'})).toBeTruthy();const section=screen.getByText('运行版本').closest('details')!;expect(section.textContent).toContain('版本待确认');expect(section.textContent).not.toContain('已应用当前版本');expect(section.textContent).toContain('不能据此判断更新已生效');
});
