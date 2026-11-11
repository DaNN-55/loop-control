import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SystemStatusDrawer} from './SystemStatusDrawer';
import type {RuntimeStatus} from '../observability/runtimeStatus';
afterEach(cleanup);
const at='2026-11-02T04:00:00Z',gb=1024**3;
function fixture():RuntimeStatus{return{observedAt:at,version:{state:'current',backendReleaseId:'a',workerReleaseId:'a',preparedReleaseId:'a',startedAt:at,checkedAt:at},worker:{state:'healthy',heartbeatAt:at,lastScanAt:at,active:0,capacity:1,problem:null},queue:{total:0,running:0,queued:0,blocked:0,failed:0,items:[],page:1,pageSize:20},resources:{cpuPercent:0,memory:{freeBytes:8*gb,totalBytes:32*gb},disk:{availableBytes:100*gb,totalBytes:500*gb,sourcePath:'/Applications/Loop Control'},systemDisk:{availableBytes:100*gb,totalBytes:500*gb,sourcePath:'/Users/owner'},media:{state:'healthy',availableBytes:50*gb,totalBytes:200*gb,minimumFreeBytes:gb,sourcePath:'/Volumes/制作素材盘/library',mountPath:'/Volumes/制作素材盘',sameVolume:false}}};}
function show(runtime:RuntimeStatus){render(<SystemStatusDrawer open onOpen={vi.fn()} onClose={vi.fn()} runtime={runtime} maintenance={[]} maintenanceAvailable pending={false} error="" observedAt={at} onRefresh={vi.fn()} onPage={vi.fn()}/>);return screen.getByText('资源状态').closest('details')!;}
it('separates system and media free capacity in the summary and exposes their actual sources',()=>{
 const section=show(fixture());expect(section.querySelector('summary')!.textContent).toContain('系统盘可用 100 GB · 素材盘可用 50 GB');
 fireEvent.click(within(section).getByText('资源状态'));expect(section.textContent).toContain('100 GB / 500 GB');expect(section.textContent).toContain('50 GB / 200 GB');expect(within(section).getByText('/Users/owner')).toBeTruthy();expect(within(section).getByText('/Volumes/制作素材盘/library')).toBeTruthy();expect(within(section).getByText('/Volumes/制作素材盘')).toBeTruthy();
});
it('identifies a shared volume without adding or repeating its capacity',()=>{
 const value=fixture();Object.assign(value.resources!.media,{sameVolume:true,availableBytes:100*gb,totalBytes:500*gb});const section=show(value);
 expect(section.querySelector('summary')!.textContent).toContain('系统盘与素材盘共用空间 · 可用 100 GB');expect(section.textContent).toContain('与系统盘同卷，共用上述空间');expect(section.textContent).not.toContain('200 GB');expect(within(section).getAllByText('100 GB / 500 GB')).toHaveLength(1);
});
it('an unavailable media disk never shows stale or zero capacity while the system disk remains readable',()=>{
 const value=fixture();Object.assign(value.resources!.media,{state:'offline',availableBytes:null,totalBytes:null,sameVolume:null});const section=show(value);
 expect(section.querySelector('summary')!.textContent).toContain('系统盘可用 100 GB · 素材盘不可用');expect(section.textContent).toContain('素材盘');expect(within(section).queryByText(/^0 GB(?: \/|$)/)).toBeNull();expect(screen.getByRole('button',{name:'系统状态：需处理'})).toBeTruthy();
});
it('a failed system disk read remains explicit instead of claiming a healthy zero capacity',()=>{
 const value=fixture();value.resources!.systemDisk=null;const section=show(value);expect(section.querySelector('summary')!.textContent).toContain('系统盘读取失败');expect(within(section).queryByText(/^0 GB(?: \/|$)/)).toBeNull();
});
it('does not relabel a legacy program-volume reading as the system disk',()=>{
 const value=fixture();delete value.resources!.systemDisk;const section=show(value);expect(section.querySelector('summary')!.textContent).toContain('系统盘待确认');expect(within(section).queryByText('/Applications/Loop Control')).toBeNull();expect(screen.getByRole('button',{name:'系统状态：待确认'})).toBeTruthy();
});
it('visualizes measured usage without treating a real zero CPU reading as unknown',()=>{
 const section=show(fixture());fireEvent.click(within(section).getByText('资源状态'));
 expect(within(section).getByRole('img',{name:'CPU 使用 0%'})).toBeTruthy();
 expect(within(section).getByRole('img',{name:'内存 非空闲 75%'})).toBeTruthy();
 expect(within(section).getByRole('img',{name:'系统盘 已用 80%'})).toBeTruthy();
 expect(within(section).getByRole('img',{name:'素材盘 已用 75%'})).toBeTruthy();
 expect(within(section).getByText('8 GB / 32 GB')).toBeTruthy();
});
it('shows non-free memory proportion without claiming memory pressure from free memory alone',()=>{
 const value=fixture();value.resources!.memory={freeBytes:.1*gb,totalBytes:16*gb};const section=show(value);fireEvent.click(within(section).getByText('资源状态'));
 const memory=within(section).getByRole('img',{name:'内存 非空闲 99%'});expect(memory.classList.contains('is-warning')).toBe(false);
 expect(within(section).getByText('0.1 GB / 16 GB')).toBeTruthy();expect(screen.getByRole('button',{name:'系统状态：正常'})).toBeTruthy();
});
it('uses the system disk measurement for an explicitly shared media volume',()=>{
 const value=fixture();Object.assign(value.resources!.media,{sameVolume:true,availableBytes:1,totalBytes:2});const section=show(value);fireEvent.click(within(section).getByText('资源状态'));
 expect(within(section).getByRole('img',{name:'素材盘 已用 80%'})).toBeTruthy();expect(within(section).getByText('与系统盘同卷，共用上述空间')).toBeTruthy();expect(within(section).getAllByText('100 GB / 500 GB')).toHaveLength(1);
});
it('does not visualize stale media capacity while the volume is offline',()=>{
 const value=fixture();value.resources!.media.state='offline';const section=show(value);fireEvent.click(within(section).getByText('资源状态'));
 const media=within(section).getByRole('img',{name:'素材盘 已用比例不可用'});expect(media.querySelector('.status-drawer-resource-ring-value')).toBeNull();expect(within(section).queryByText('50 GB / 200 GB')).toBeNull();
});
it('leaves missing or mathematically invalid ratios unknown rather than showing zero or NaN',()=>{
 const value=fixture();value.resources!.cpuPercent=null;value.resources!.memory.totalBytes=0;value.resources!.systemDisk!.availableBytes=600*gb;value.resources!.media.totalBytes=null;const section=show(value);fireEvent.click(within(section).getByText('资源状态'));
 expect(within(section).getAllByRole('img')).toHaveLength(4);expect(section.querySelectorAll('.status-drawer-resource-ring-value')).toHaveLength(0);expect(section.textContent).not.toMatch(/NaN|Infinity/);
 expect(within(section).getByRole('img',{name:'CPU 使用比例未读取'})).toBeTruthy();
});
