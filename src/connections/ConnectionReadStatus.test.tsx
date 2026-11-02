import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ConnectionWorkspace,type ExternalConnection} from './ConnectionWorkspace';
import type {ConnectionUsageSummary} from './connectionUsage';
afterEach(cleanup);
const connection=(id:string,provider='minimax',adapter='minimax_video')=>({id,name:id,provider,adapter,status:'verified',current_version_id:id+'-v',last_verified_at:'2026-10-30T10:20:00Z'} as ExternalConnection);
const summary:ConnectionUsageSummary={remaining:{label:'可用额',text:'¥12.34',status:'ready',detail:'包含现金与代金券。'},recent:{label:'近7天',text:'暂不支持',status:'unsupported',detail:'供应商未提供此接口。'},updatedAt:'2026-11-01T09:30:00Z'};
const actions={onCreateConnection:vi.fn(),onTestConnection:vi.fn()};
it('shows service display name and nearby historical verification time without probing',()=>{
 const c=connection('长连接名称'.repeat(12));render(<ConnectionWorkspace {...actions} connections={[c]}/>);
 const row=screen.getByRole('button',{name:c.name}).closest('tr')!;
 expect(within(row).getByRole('cell',{name:'MiniMax'})).toBeTruthy();
 const time=row.querySelector('time');expect(time?.dateTime).toBe(c.last_verified_at);expect(time?.parentElement?.textContent).toContain('最近验证');
 expect(actions.onTestConnection).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:c.name}));
 const detail=screen.getByRole('dialog');expect(within(detail).getByText('MiniMax')).toBeTruthy();expect(within(detail).getByText('minimax')).toBeTruthy();expect(within(detail).getByText('minimax_video')).toBeTruthy();
});
it('keeps account amounts distinct from shared request allowances and resource packs with accessible cache details',()=>{
 const a=connection('账号 A'),b=connection('账号 B'),p=connection('请求 Key','pexels','pexels_video'),k=connection('资源包 Key','kling','kling_video');
 render(<ConnectionWorkspace {...actions} connections={[a,b,p,k]} usageByVersion={{[a.current_version_id!]:summary,[b.current_version_id!]:summary,[p.current_version_id!]:{...summary,remaining:{label:'请求余量',text:'97 次',status:'ready',detail:'供应商返回的请求限额，不是余额。'}},[k.current_version_id!]:{...summary,remaining:{label:'包余量',text:'2 个有效包',status:'ready',detail:'账号级资源包，约 12 小时延迟。'}}}}/>);
 const aCell=screen.getByRole('cell',{name:'账号 A 额度与用量'});
 expect(within(aCell).getByText('供应商账号可用额')).toBeTruthy();
 const details=within(aCell).getByText('账务详情').closest('summary')!;expect(details.tagName).toBe('SUMMARY');
 fireEvent.click(details);
 expect(aCell.textContent).toContain('同一供应商账号的多个 Key 可能共享，不应逐连接相加');expect(aCell.textContent).toContain('缓存');expect(aCell.textContent).toContain('非实时');expect(aCell.querySelector('time')?.dateTime).toBe(summary.updatedAt);
 expect(screen.getByRole('cell',{name:'请求 Key 额度与用量'}).textContent).toContain('Key 请求余量');
 expect(screen.getByRole('cell',{name:'资源包 Key 额度与用量'}).textContent).toContain('账号资源包');
 expect(screen.queryByText('¥24.68')).toBeNull();
});
it('keeps failed unknown values and their unavailable timestamp separate from zero',()=>{
 const c=connection('未知账务');render(<ConnectionWorkspace {...actions} connections={[c]} usageByVersion={{[c.current_version_id!]:{remaining:{label:'可用额',text:'读取失败',status:'unavailable',detail:'权限不足，请检查账务凭据。'},recent:summary.recent,updatedAt:null}}}/>);
 const cell=screen.getByRole('cell',{name:'未知账务 额度与用量'});fireEvent.click(within(cell).getByText('账务详情'));
 expect(cell.textContent).toContain('尚无成功读取时间');expect(cell.textContent).toContain('权限不足');expect(cell.textContent).not.toContain('¥0');expect(cell.querySelector('time')).toBeNull();
});
it('applies only submitted normalized search and clears the applied URL query with X',()=>{
 const a=connection('Alpha'),b=connection('Beta');const change=vi.fn();
 const navigation={value:{q:'',capability:'all',status:'',connection:''},change};
 render(<ConnectionWorkspace {...actions} connections={[a,b]} navigation={navigation}/>);
 const input=screen.getByRole('searchbox',{name:'查找已存连接'});
 fireEvent.change(input,{target:{value:'  Alpha  '}});expect(screen.getByRole('button',{name:'Beta'})).toBeTruthy();expect(change).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'搜索'}));expect(screen.queryByRole('button',{name:'Beta'})).toBeNull();expect((input as HTMLInputElement).value).toBe('Alpha');expect(change).toHaveBeenLastCalledWith({q:'Alpha'});
 fireEvent.click(screen.getByRole('button',{name:'清除连接搜索'}));expect(screen.getByRole('button',{name:'Beta'})).toBeTruthy();expect(change).toHaveBeenLastCalledWith({q:''});
 fireEvent.change(input,{target:{value:'  Beta  '}});fireEvent.submit(screen.getByRole('search',{name:'搜索连接'}));expect(screen.queryByRole('button',{name:'Alpha'})).toBeNull();expect(change).toHaveBeenLastCalledWith({q:'Beta'});
});
