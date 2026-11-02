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
 expect(within(table).getAllByRole('columnheader').map(cell=>cell.textContent)).toEqual(['连接','服务','模型','验证','凭据版本','额度 / 近7天','操作','更多操作']);
 const searchCells=screen.getByRole('button',{name:fresh.name}).closest('tr')!.querySelectorAll('td');expect(searchCells[1].textContent).toBe('Pexels');expect(searchCells[2].textContent).toBe('Pexels 素材检索');
 const testCell=screen.getByRole('button',{name:'测试 '+fresh.name}).closest('td');const moreCell=screen.getByRole('button',{name:fresh.name+' 连接操作'}).closest('td');expect(testCell).not.toBe(moreCell);
 expect(screen.queryByRole('form',{name:'保存连接'})).toBeNull();
 expect(document.querySelectorAll('input[type=password]')).toHaveLength(0);
 fireEvent.change(screen.getByLabelText('查找已存连接'),{target:{value:'My Pexels'}});fireEvent.click(screen.getByRole('button',{name:'搜索'}));
 expect(within(table).queryByText(active.name)).toBeNull();expect(within(table).getByText(fresh.name)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'清除连接搜索'}));
 edit(active.name);fireEvent.change(screen.getByLabelText(/^新的 API Key/),{target:{value:'synthetic-draft'}});
 fireEvent.click(screen.getByRole('button',{name:'关闭连接窗口'}));
 fireEvent.click(screen.getByRole('button',{name:'继续编辑'}));expect((screen.getByLabelText(/^新的 API Key/)as HTMLInputElement).value).toBe('synthetic-draft');
 fireEvent.click(screen.getByRole('button',{name:'关闭连接窗口'}));fireEvent.click(screen.getByRole('button',{name:'放弃修改并关闭'}));
 edit(active.name);expect((screen.getByLabelText(/^新的 API Key/)as HTMLInputElement).value).toBe('');fireEvent.click(screen.getByRole('button',{name:'关闭连接窗口'}));
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
 fireEvent.change(screen.getByLabelText('生产能力'),{target:{value:'speech'}});
 const table=screen.getByRole('table');expect(within(table).queryByText(a.name)).toBeNull();expect(within(table).getByText(b.name)).toBeTruthy();const cells=within(table).getByText(b.name).closest('tr')!.querySelectorAll('td');expect(cells[1].textContent).toBe('豆包语音');expect(cells[2].textContent).toBe('seed-tts-2.0');expect(within(table).getAllByText('—')).toHaveLength(1);
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

it('retries a failed verification from the result without reloading or saving the credential again',async()=>{
 const connection={...row('minimax','MiniMax fixture'),provider:'minimax',adapter:'minimax_video'};
 let finish!:(value:unknown)=>void;
 const test=vi.fn().mockResolvedValueOnce({ready:false,detail:'服务拒绝认证或权限（HTTP 401）。'}).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
 const refresh=vi.fn(),rotate=vi.fn(),create=vi.fn();
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={create} onRotateConnection={rotate} onTestConnection={test} onRefresh={refresh}/>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'测试 '+connection.name})));
 const result=screen.getByLabelText('连接操作结果');
 expect(within(result).queryByRole('button',{name:'重新读取连接'})).toBeNull();
 const retry=within(result).getByRole('button',{name:'重新测试'});
 fireEvent.click(retry);fireEvent.click(retry);
 expect(test).toHaveBeenCalledTimes(2);expect(test).toHaveBeenLastCalledWith(connection.id);
 expect(result.textContent).toContain('正在测试连接');
 await act(async()=>finish({ready:true,detail:'连接验证通过。'}));
 expect(result.textContent).toContain('连接测试通过');expect(result.textContent).not.toContain('HTTP 401');
 expect(refresh).not.toHaveBeenCalled();expect(rotate).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
});

it('keeps credential-save success explicit when verification fails and retries without another rotation',async()=>{
 const connection={...row('saved-minimax','Saved MiniMax'),provider:'minimax',adapter:'minimax_video'};
 const rotate=vi.fn().mockResolvedValue({...connection,current_version_id:'saved-minimax-v3'});
 const test=vi.fn().mockResolvedValue({ready:false,detail:'服务拒绝认证或权限（HTTP 401）。'});
 const refresh=vi.fn();
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onRotateConnection={rotate} onTestConnection={test} onRefresh={refresh}/>);
 edit(connection.name);fireEvent.change(screen.getByLabelText(/^新的 API Key/),{target:{value:'synthetic-new-key'}});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'保存并测试'})));
 expect(screen.getByRole('dialog',{name:'编辑连接'})).toBeTruthy();
 expect((screen.getByLabelText(/^新的 API Key/)as HTMLInputElement).value).toBe('');
 const result=within(screen.getByRole('dialog')).getByLabelText('连接操作结果');
 expect(result.textContent).toContain('凭据已保存，连接测试未通过');
 await act(async()=>fireEvent.click(within(result).getByRole('button',{name:'重新测试'})));
 expect(rotate).toHaveBeenCalledOnce();expect(test).toHaveBeenCalledTimes(2);expect(refresh).not.toHaveBeenCalled();
});

it('saves MiniMax site with the new key and restores the saved site on reopening',async()=>{
 const connection={...row('cn','Domestic MiniMax'),provider:'minimax',adapter:'minimax_video',region:'cn' as const};
 const rotate=vi.fn().mockResolvedValue(connection);
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onRotateConnection={rotate} onTestConnection={vi.fn().mockResolvedValue({ready:true})}/>);
 edit(connection.name);expect((screen.getByLabelText(/^MiniMax 站点/)as HTMLSelectElement).value).toBe('cn');
 expect((screen.getByLabelText(/^MiniMax 站点/)as HTMLSelectElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText(/^新的 API Key/),{target:{value:'synthetic-international-key'}});
 fireEvent.change(screen.getByLabelText(/^MiniMax 站点/),{target:{value:'international'}});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'保存并测试'})));
 expect(rotate).toHaveBeenCalledWith({connectionId:connection.id,provider:'minimax',adapter:'minimax_video',secret:JSON.stringify({apiKey:'synthetic-international-key',region:'international'})});
});

it('changes MiniMax site using the saved key without asking for or rotating a replacement key in the browser',async()=>{
 const connection={...row('retained','Retained MiniMax'),provider:'minimax',adapter:'minimax_video',region:'international' as const};
 const changeRegion=vi.fn().mockResolvedValue({...connection,region:'cn'}),rotate=vi.fn(),test=vi.fn().mockResolvedValue({ready:true});
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onRotateConnection={rotate} onChangeRegion={changeRegion} onTestConnection={test}/>);
 edit(connection.name);fireEvent.change(screen.getByLabelText(/^MiniMax 站点/),{target:{value:'cn'}});
 expect((screen.getByLabelText(/^新的 API Key/)as HTMLInputElement).value).toBe('');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'保存并测试'})));
 expect(changeRegion).toHaveBeenCalledWith({connectionId:connection.id,versionId:connection.current_version_id,region:'cn'});
 expect(rotate).not.toHaveBeenCalled();expect(test).toHaveBeenCalledWith(connection.id);expect(screen.queryByRole('dialog')).toBeNull();
});

it('places two truthful usage lines after the credential version and keeps other versions isolated',()=>{
 const connection=row('usage','Usage fixture');
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()} usageByVersion={{[connection.current_version_id!]:{remaining:{label:'日余量',text:'1,998 次',detail:'共享请求限额，不是余额。',status:'ready'},recent:{label:'近7天',text:'8 次',detail:'供应商请求次数。',status:'ready'},updatedAt:'2026-11-01T00:00:00Z'},'old-version':{remaining:{label:'余额',text:'¥999',detail:'旧版本',status:'ready'},recent:{label:'近7天',text:'¥123',detail:'旧版本',status:'ready'},updatedAt:null}}}/>);
 const headers=screen.getAllByRole('columnheader').map(c=>c.textContent);expect(headers.indexOf('额度 / 近7天')).toBe(headers.indexOf('凭据版本')+1);
 const cell=screen.getByRole('cell',{name:'Usage fixture 额度与用量'});expect(cell.querySelectorAll('.reference-connection-usage-line')).toHaveLength(2);expect(cell.textContent).toContain('1,998 次');expect(cell.textContent).toContain('8 次');expect(screen.queryByText('¥999')).toBeNull();
});

it('hides unused capabilities and verification states and restores them when records arrive',()=>{
 const a=row('a','Pexels'),props={onCreateConnection:vi.fn(),onTestConnection:vi.fn()};
 const {rerender}=render(<ConnectionWorkspace {...props} connections={[a]}/>);
 const capabilities=screen.getByRole('combobox',{name:'生产能力'}),statuses=screen.getByRole('combobox',{name:'验证状态'});
 expect(within(capabilities).getAllByRole('option')).toHaveLength(2);expect(within(statuses).getAllByRole('option')).toHaveLength(2);
 fireEvent.change(screen.getByLabelText('查找已存连接'),{target:{value:'absent'}});expect(within(capabilities).getAllByRole('option')).toHaveLength(2);
 rerender(<ConnectionWorkspace {...props} connections={[a,{...a,id:'tts',provider:'volcengine_tts',adapter:'volcengine_tts',status:'invalid'}]}/>);
 expect(within(capabilities).getByRole('option',{name:'语音'})).toBeTruthy();expect(within(statuses).getAllByRole('option')).toHaveLength(3);
});
