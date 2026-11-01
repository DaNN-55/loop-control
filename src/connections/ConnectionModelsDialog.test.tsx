import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
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
