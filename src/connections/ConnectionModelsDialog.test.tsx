import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {ConnectionModelsDialog} from './ConnectionModelsDialog';
import {ConnectionWorkspace,type ExternalConnection} from './ConnectionWorkspace';
import type {ConnectionModelSettings} from './connectionModels';
afterEach(cleanup);
const data:ConnectionModelSettings={connectionId:'c',versionId:'v',revision:'default',enabledModels:['gpt-image-2'],models:[{id:'gpt-image-2',adapted:true,listed:false,capability:'图片'}],discovery:{supported:true,detail:'读取供应商目录不会生成内容。',readAt:null}};
it('offers models only in generation connection actions and leaves the create form unchanged',async()=>{
 const user=userEvent.setup();const connection={id:'c',name:'Images',provider:'openai',adapter:'openai_images',current_version_id:'v',status:'verified'}as ExternalConnection,read=vi.fn().mockResolvedValue(data);
 render(<ConnectionWorkspace connections={[connection,{...connection,id:'p',name:'Pexels',provider:'pexels',adapter:'pexels_video'}]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()} onReadModels={read}/>);
 await user.click(screen.getByRole('button',{name:'Images 连接操作'}));await user.click(screen.getByRole('menuitem',{name:'模型设置'}));
 expect(await screen.findByRole('dialog',{name:'Images 模型设置'})).toBeTruthy();expect(read).toHaveBeenCalledExactlyOnceWith('c');
 await user.click(screen.getByRole('button',{name:'关闭模型设置'}));
 await user.click(screen.getByRole('button',{name:'Pexels 连接操作'}));expect(screen.queryByRole('menuitem',{name:'模型设置'})).toBeNull();await user.keyboard('{Escape}');
 await user.click(screen.getByRole('button',{name:'新建连接'}));expect(screen.getByRole('form',{name:'保存连接'})).toBeTruthy();expect(screen.queryByRole('button',{name:'读取模型'})).toBeNull();
});
it('keeps unsaved choices on discovery, filters results, and never enables unadapted models',async()=>{
 const user=userEvent.setup(),save=vi.fn().mockResolvedValue(data),close=vi.fn(),sync=vi.fn().mockResolvedValue({...data,models:[{...data.models[0],listed:true},{id:'text-new',adapted:false,listed:true,capability:'未分类'}],discovery:{supported:true,detail:'已读取2个模型。',readAt:'now'}});
 render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={close} onReadModels={async()=>data} onSyncModels={sync} onSaveModels={save}/>);
 const model=await screen.findByRole('checkbox',{name:'gpt-image-2'});await user.click(model);await user.click(screen.getByRole('button',{name:'读取模型'}));
 expect((screen.getByRole('checkbox',{name:'gpt-image-2'})as HTMLInputElement).checked).toBe(false);expect((screen.getByRole('checkbox',{name:'text-new'})as HTMLInputElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('模型范围'),{target:{value:'unadapted'}});expect(screen.queryByRole('checkbox',{name:'gpt-image-2'})).toBeNull();
 fireEvent.change(screen.getByLabelText('搜索模型'),{target:{value:'absent'}});expect(screen.getByText('没有匹配的模型。')).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'保存设置'}));expect(save).toHaveBeenCalledExactlyOnceWith({connectionId:'c',versionId:'v',revision:'default',enabledModels:[]});expect(close).toHaveBeenCalledOnce();
});
it('shows read failures with retry and preserves selected models and a visible error on failed sync/save',async()=>{
 const user=userEvent.setup(),read=vi.fn().mockRejectedValueOnce(Error('网络暂不可用')).mockResolvedValue(data),close=vi.fn();
 render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={close} onReadModels={read} onSyncModels={async()=>{throw Error('HTTP 401');}} onSaveModels={async()=>{throw Error('版本已变化');}}/>);
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','网络暂不可用');await user.click(screen.getByRole('button',{name:'重新读取设置'}));
 await user.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));await user.click(screen.getByRole('button',{name:'读取模型'}));expect(screen.getByRole('alert').textContent).toBe('HTTP 401');
 expect((screen.getByRole('checkbox',{name:'gpt-image-2'})as HTMLInputElement).checked).toBe(false);
 await user.click(screen.getByRole('button',{name:'保存设置'}));expect(screen.getByRole('alert').textContent).toBe('版本已变化');expect(close).not.toHaveBeenCalled();
});
it('locks repeated syncs and saving until a read finishes',async()=>{
 let finish!:(value:ConnectionModelSettings)=>void;const sync=vi.fn(()=>new Promise<ConnectionModelSettings>(resolve=>finish=resolve));
 render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={vi.fn()} onReadModels={async()=>data} onSyncModels={sync}/>);
 await screen.findByRole('checkbox');const button=screen.getByRole('button',{name:'读取模型'});fireEvent.click(button);fireEvent.click(button);expect(sync).toHaveBeenCalledOnce();
 expect((screen.getByRole('button',{name:'关闭模型设置'})as HTMLButtonElement).disabled).toBe(true);await act(async()=>finish(data));
 expect(within(screen.getByLabelText('可选模型')).getByRole('checkbox')).toBeTruthy();
});

it('hides empty model ranges and restores the enabled range as models are selected',async()=>{
 render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={vi.fn()} onReadModels={async()=>({...data,enabledModels:[]})}/>);
 await screen.findByRole('checkbox',{name:'gpt-image-2'});
 const range=screen.getByRole('combobox',{name:'模型范围'});expect(within(range).queryByRole('option',{name:'尚未适配'})).toBeNull();expect(within(range).queryByRole('option',{name:'已启用'})).toBeNull();
 fireEvent.click(screen.getByRole('checkbox',{name:'gpt-image-2'}));expect(within(range).getByRole('option',{name:'已启用'})).toBeTruthy();
});
it('protects changed model choices on Escape and can keep them through close/reopen',async()=>{
 const user=userEvent.setup();const connection={id:'c',name:'Images',provider:'openai',adapter:'openai_images',current_version_id:'v',status:'verified'}as ExternalConnection;
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()} onReadModels={async()=>data}/>);
 await user.click(screen.getByRole('button',{name:'Images 连接操作'}));await user.click(screen.getByRole('menuitem',{name:'模型设置'}));await user.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));
 await user.keyboard('{Escape}');expect(screen.getByRole('dialog',{name:'关闭前处理修改'})).toBeTruthy();await user.click(screen.getByRole('button',{name:'关闭确认，继续编辑'}));expect((screen.getByRole('checkbox',{name:'gpt-image-2'})as HTMLInputElement).checked).toBe(false);
 await user.click(screen.getByRole('button',{name:'关闭模型设置'}));await user.click(screen.getByRole('button',{name:'保留修改并关闭'}));
 await user.click(screen.getByRole('button',{name:'Images 连接操作'}));await user.click(screen.getByRole('menuitem',{name:'模型设置'}));expect((await screen.findByRole('checkbox',{name:'gpt-image-2'})as HTMLInputElement).checked).toBe(false);
 await user.click(screen.getByRole('button',{name:'取消'}));await user.click(screen.getByRole('button',{name:'放弃修改并关闭'}));
 await user.click(screen.getByRole('button',{name:'Images 连接操作'}));await user.click(screen.getByRole('menuitem',{name:'模型设置'}));expect((await screen.findByRole('checkbox',{name:'gpt-image-2'})as HTMLInputElement).checked).toBe(true);
});
it('does not restore model drafts over a newer revision and does not close an unconfirmed save',async()=>{
 const close=vi.fn();render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={close} onReadModels={async()=>({...data,revision:'new-revision'})} draft={{versionId:'v',revision:'old-revision',enabledModels:[]}} onDraftChange={vi.fn()} onSaveModels={async()=>undefined as unknown as ConnectionModelSettings}/>);
 const model=await screen.findByRole('checkbox',{name:'gpt-image-2'});expect((model as HTMLInputElement).checked).toBe(true);expect(screen.getByText('保留的修改所依据的版本已变化，已读取当前设置。')).toBeTruthy();fireEvent.click(model);fireEvent.click(screen.getByRole('button',{name:'保存设置'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','模型设置保存未确认完成，请重新读取后核对。');expect(close).not.toHaveBeenCalled();
});
it('forgets retained model edits when the owner changes back to the server selection',async()=>{
 const user=userEvent.setup(),connection={id:'c',name:'Images',provider:'openai',adapter:'openai_images',current_version_id:'v',status:'verified'}as ExternalConnection;
 render(<ConnectionWorkspace connections={[connection]} onCreateConnection={vi.fn()} onTestConnection={vi.fn()} onReadModels={async()=>data}/>);
 async function open(){await user.click(screen.getByRole('button',{name:'Images 连接操作'}));await user.click(screen.getByRole('menuitem',{name:'模型设置'}));return await screen.findByRole('checkbox',{name:'gpt-image-2'});}
 await user.click(await open());await user.click(screen.getByRole('button',{name:'取消'}));await user.click(screen.getByRole('button',{name:'保留修改并关闭'}));await user.click(await open());await user.click(screen.getByRole('button',{name:'取消'}));expect(screen.queryByRole('dialog')).toBeNull();expect((await open()as HTMLInputElement).checked).toBe(true);
});
it('restores keyboard focus after an asynchronous failed save loses the disabled submit button',async()=>{
 const user=userEvent.setup();let reject!:(cause:Error)=>void;render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={vi.fn()} onReadModels={async()=>data} onSaveModels={()=>new Promise((_resolve,fail)=>{reject=fail;})}/>);await user.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));await user.click(screen.getByRole('button',{name:'保存设置'}));act(()=>{document.body.tabIndex=-1;document.body.focus();});await act(async()=>reject(Error('保存冲突')));expect(await screen.findByRole('alert')).toHaveProperty('textContent','保存冲突');expect(document.activeElement).toBe(screen.getByRole('dialog',{name:'Images 模型设置'}));await user.keyboard('{Escape}');expect(screen.getByRole('dialog',{name:'关闭前处理修改'})).toBeTruthy();document.body.removeAttribute('tabindex');
});
it('refreshes an unedited enabled selection from the server instead of creating a draft against a newer revision',async()=>{
 const initial={...data,revision:'r1',models:[...data.models,{id:'model-2',adapted:true,listed:true,capability:'图片'}]},newer={...initial,revision:'r2',enabledModels:['model-2']},save=vi.fn();
 render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={vi.fn()} onReadModels={async()=>initial} onSyncModels={async()=>newer} onSaveModels={save}/>);
 await screen.findByRole('checkbox',{name:'gpt-image-2'});expect(screen.getByRole('button',{name:'保存设置'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'读取模型'}));
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:'model-2'})).toHaveProperty('checked',true));expect(screen.getByText('尚未修改')).toBeTruthy();expect(screen.getByRole('checkbox',{name:'gpt-image-2'})).toHaveProperty('checked',false);expect(screen.getByRole('button',{name:'保存设置'})).toHaveProperty('disabled',true);expect(save).not.toHaveBeenCalled();
});
it('preserves a dirty selection and its original version after discovery observes a concurrent settings change',async()=>{
 const initial={...data,revision:'r1',models:[...data.models,...['model-2','model-3'].map(id=>({id,adapted:true,listed:true,capability:'图片'}))]},newer={...initial,revision:'r2',enabledModels:['model-2']},save=vi.fn(),keep=vi.fn();
 render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={vi.fn()} onReadModels={async()=>initial} onSyncModels={async()=>newer} onSaveModels={save} onDraftChange={keep}/>);
 fireEvent.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));fireEvent.click(screen.getByRole('checkbox',{name:'model-3'}));fireEvent.click(screen.getByRole('button',{name:'读取模型'}));
 expect((await screen.findByRole('alert')).textContent).toContain('其他窗口');expect(screen.getByRole('checkbox',{name:'model-3'})).toHaveProperty('checked',true);expect(screen.getByRole('button',{name:'保存设置'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'保存设置'}));expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'取消'}));fireEvent.click(screen.getByRole('button',{name:'保留修改并关闭'}));expect(keep).toHaveBeenLastCalledWith({versionId:'v',revision:'r1',enabledModels:['model-3']});
});
it('keeps a real draft while discovery advances only the revision and saves against that unchanged server selection',async()=>{
 const initial={...data,revision:'r1'},newer={...data,revision:'r2'},save=vi.fn().mockResolvedValue({...newer,enabledModels:[]});
 render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={vi.fn()} onReadModels={async()=>initial} onSyncModels={async()=>newer} onSaveModels={save}/>);fireEvent.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));fireEvent.click(screen.getByRole('button',{name:'读取模型'}));await waitFor(()=>expect(screen.getByRole('button',{name:'保存设置'})).toHaveProperty('disabled',false));
 expect(screen.getByRole('checkbox',{name:'gpt-image-2'})).toHaveProperty('checked',false);expect(screen.queryByRole('alert')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'保存设置'}));await waitFor(()=>expect(save).toHaveBeenCalledExactlyOnceWith({connectionId:'c',versionId:'v',revision:'r2',enabledModels:[]}));
});
it('keeps the draft when a later server change rejects save and never retries with another baseline',async()=>{
 const initial={...data,revision:'r1'},save=vi.fn().mockRejectedValue(Error('模型设置已被修改，请重新打开后保存。')),keep=vi.fn(),close=vi.fn();
 render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={close} onReadModels={async()=>initial} onSaveModels={save} onDraftChange={keep}/>);fireEvent.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));fireEvent.click(screen.getByRole('button',{name:'保存设置'}));await screen.findByRole('alert');expect(save).toHaveBeenCalledExactlyOnceWith({connectionId:'c',versionId:'v',revision:'r1',enabledModels:[]});expect(close).not.toHaveBeenCalled();expect(screen.getByRole('checkbox',{name:'gpt-image-2'})).toHaveProperty('checked',false);
 fireEvent.click(screen.getByRole('button',{name:'取消'}));fireEvent.click(screen.getByRole('button',{name:'保留修改并关闭'}));expect(keep).toHaveBeenLastCalledWith({versionId:'v',revision:'r1',enabledModels:[]});
});
it('does not transplant a draft when a discovery response belongs to another connection version',async()=>{
 const initial={...data,revision:'r1'},keep=vi.fn(),save=vi.fn();render(<ConnectionModelsDialog connection={{id:'c',name:'Images'}} onClose={vi.fn()} onReadModels={async()=>initial} onSyncModels={async()=>({...data,versionId:'rotated',revision:'r2'})} onSaveModels={save} onDraftChange={keep}/>);
 fireEvent.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));fireEvent.click(screen.getByRole('button',{name:'读取模型'}));expect((await screen.findByRole('alert')).textContent).toContain('连接版本已变化');expect(screen.getByRole('checkbox',{name:'gpt-image-2'})).toHaveProperty('checked',false);fireEvent.click(screen.getByRole('button',{name:'取消'}));fireEvent.click(screen.getByRole('button',{name:'保留修改并关闭'}));expect(keep).toHaveBeenLastCalledWith({versionId:'v',revision:'r1',enabledModels:[]});expect(save).not.toHaveBeenCalled();
});
