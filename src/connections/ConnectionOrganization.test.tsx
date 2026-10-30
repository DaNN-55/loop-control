import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ConnectionWorkspace,type ExternalConnection} from './ConnectionWorkspace';
afterEach(cleanup);
const row=(id:string,name:string,used=0)=>({id,name,provider:'pexels',adapter:'pexels_video',current_version_id:id+'-v',status:'verified',description:'',usage:{currentBlueprints:used,episodes:used,tasks:used}} as ExternalConnection);
function edit(name:string){fireEvent.click(screen.getByRole('button',{name}));fireEvent.click(screen.getByRole('button',{name:'编辑连接'}));}
it('starts with the reference table and opens the single editor on demand',()=>{
 const active=row('active','TTS multishot pexels fixture',1),fresh=row('fresh','My Pexels');
 render(<ConnectionWorkspace connections={[active,fresh]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()} onUpdateConnection={vi.fn()}/>);
 const table=screen.getByRole('table',{name:'已保存连接'});
 expect(within(table).getAllByRole('columnheader').map(cell=>cell.textContent)).toEqual(['连接','能力','模型 / 服务','验证','凭据版本','测试','更多操作']);
 const testCell=screen.getByRole('button',{name:'测试 '+fresh.name}).closest('td');const moreCell=screen.getByRole('button',{name:fresh.name+' 连接操作'}).closest('td');expect(testCell).not.toBe(moreCell);
 expect(screen.queryByRole('form',{name:'保存连接'})).toBeNull();
 expect(document.querySelectorAll('input[type=password]')).toHaveLength(0);
 fireEvent.change(screen.getByLabelText('查找已存连接'),{target:{value:'My Pexels'}});
 expect(within(table).queryByText(active.name)).toBeNull();expect(within(table).getByText(fresh.name)).toBeTruthy();
 fireEvent.change(screen.getByLabelText('查找已存连接'),{target:{value:''}});
 edit(active.name);fireEvent.change(screen.getByLabelText(/^新的 API Key/),{target:{value:'synthetic-draft'}});
 fireEvent.click(screen.getByRole('button',{name:'关闭连接窗口'}));
 edit(active.name);expect((screen.getByLabelText(/^新的 API Key/)as HTMLInputElement).value).toBe('synthetic-draft');
 fireEvent.click(screen.getByRole('button',{name:'关闭连接窗口'}));
 edit(fresh.name);expect((screen.getByLabelText(/^新的 API Key/)as HTMLInputElement).value).toBe('');
});
it('saves selected metadata and tests the unchanged credential through the unified action',async()=>{
 const a=row('a','First'),b=row('b','Second'),update=vi.fn().mockResolvedValue(undefined),rotate=vi.fn(),test=vi.fn();
 render(<ConnectionWorkspace connections={[a,b]} onCreateConnection={vi.fn()} onUpdateConnection={update} onRotateConnection={rotate} onTestConnection={test}/>);
 edit(b.name);fireEvent.change(screen.getByLabelText(/^连接名称/),{target:{value:'Renamed'}});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'保存并测试'})));
 expect(update).toHaveBeenCalledWith({connectionId:'b',name:'Renamed',description:''});expect(rotate).not.toHaveBeenCalled();expect(test).toHaveBeenCalledWith('b');
});
it('tests a stored connection directly without creating, updating or rotating credentials',async()=>{
 const connection=row('same-level','Current connection'),create=vi.fn(),update=vi.fn(),rotate=vi.fn(),test=vi.fn().mockResolvedValue({ready:true,detail:'连接验证通过。'});
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={create} onUpdateConnection={update} onRotateConnection={rotate} onTestConnection={test}/>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:`测试 ${connection.name}`})));
 expect(test).toHaveBeenCalledExactlyOnceWith(connection.id);expect(create).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();expect(rotate).not.toHaveBeenCalled();
 expect(screen.getByLabelText('连接操作结果').textContent).toContain('连接测试通过');
});
it('combines capability and verification filters without inventing model values',()=>{
 const a=row('a','Pexels connection'),b={...row('b','Voice connection'),provider:'volcengine_tts',adapter:'volcengine_tts',status:'unverified' as const};
 render(<ConnectionWorkspace connections={[a,b]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText('生产能力'),{target:{value:'声音合成'}});
 const table=screen.getByRole('table');expect(within(table).queryByText(a.name)).toBeNull();expect(within(table).getByText(b.name)).toBeTruthy();const cells=within(table).getByText(b.name).closest('tr')!.querySelectorAll('td');expect(cells[1].textContent).toBe('声音合成');expect(cells[2].textContent).toBe('豆包语音 V3');expect(within(table).getAllByText('—')).toHaveLength(1);
 fireEvent.change(screen.getByLabelText('验证状态'),{target:{value:'verified'}});expect(within(table).queryByText(b.name)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'清空筛选'}));expect(within(table).getByText(a.name)).toBeTruthy();expect(within(table).getByText(b.name)).toBeTruthy();
});
it('keeps legacy adapters attached to their real provider when opening credential settings',()=>{
 const legacy={...row('legacy','Legacy Cloudflare'),provider:'cloudflare',adapter:'workers_ai_images'};
 render(<ConnectionWorkspace connections={[legacy]} verificationByProvider={{cloudflare:{available:false,detail:'Cloudflare 在线验证未启用。'},pexels:{available:true,detail:'Pexels 可测试。'}}} onCreateConnection={vi.fn()} onTestConnection={vi.fn()}/>);
 edit(legacy.name);
 expect((screen.getByLabelText('连接类型')as HTMLSelectElement).value).toBe('workers_ai_images');
 expect(screen.getByText(/Cloudflare 在线验证未启用/)).toBeTruthy();
 expect((screen.getByRole('button',{name:'保存更新'})as HTMLButtonElement).disabled).toBe(true);
});
it('locks direct table verification until its callback finishes',async()=>{
 let finish!:(result:unknown)=>void;const test=vi.fn(()=>new Promise(resolve=>finish=resolve)),connection=row('pending','Pending test');
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onTestConnection={test}/>);
 const trigger=screen.getByRole('button',{name:`测试 ${connection.name}`});fireEvent.click(trigger);fireEvent.click(trigger);
 expect(test).toHaveBeenCalledExactlyOnceWith(connection.id);expect((trigger as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByRole('button',{name:'新建连接'})as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>finish({ready:true,detail:'连接验证通过。'}));expect((trigger as HTMLButtonElement).disabled).toBe(false);
});

it('offers refresh only as recovery when a connection read fails',()=>{
 const refresh=vi.fn(),props={connections:[row('a','Existing connection')],onCreateConnection:vi.fn(),onTestConnection:vi.fn(),onRefresh:refresh};
 const view=render(<ConnectionWorkspace {...props}/>);expect(screen.queryByRole('button',{name:'刷新连接'})).toBeNull();expect(screen.queryByRole('button',{name:'重新读取连接'})).toBeNull();
 view.rerender(<ConnectionWorkspace {...props} errorMessage="连接目录读取失败。"/>);fireEvent.click(screen.getByRole('button',{name:'重新读取连接'}));expect(refresh).toHaveBeenCalledOnce();
});
