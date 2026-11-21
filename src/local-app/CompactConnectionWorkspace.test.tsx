import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {CompactConnectionWorkspace,type ConnectionSettingsHeader} from './CompactConnectionWorkspace';
import type {ExternalConnection,ExternalConnectionVersion} from '../connections/ConnectionWorkspace';
import type {ConnectionModelSettings} from '../connections/connectionModels';
import {setUiLocale} from '../i18n/ui';
afterEach(()=>{cleanup();setUiLocale('zh-CN');vi.restoreAllMocks();});
const connection={id:'c',name:'Images',description:'',provider:'openai',adapter:'openai_images',endpoint:'https://api.example.invalid/v1',current_version_id:'v2',status:'verified'} as ExternalConnection;
const versions=[{id:'v2',connection_id:'c',version:2,provider:'openai',adapter:'openai_images',endpoint:connection.endpoint,status:'verified',is_current:true,created_at:'2026-11-11T00:00:00Z',revoked_at:null,usage:{currentBlueprints:1,episodes:2,tasks:3,activeTasks:0,requests:4,savedSelections:5}},{id:'v1',connection_id:'c',version:1,provider:'openai',adapter:'openai_images',endpoint:connection.endpoint,status:'unverified',is_current:false,created_at:'2026-11-10T00:00:00Z',revoked_at:null,secretState:'unbound'}] as ExternalConnectionVersion[];
const models:ConnectionModelSettings={connectionId:'c',versionId:'v2',revision:'r1',enabledModels:['gpt-image-2'],models:[{id:'gpt-image-2',adapted:true,listed:true,capability:'图片'}],discovery:{supported:true,detail:'目录已读取。',readAt:null}};
const base={connections:[connection],versions,onCreateConnection:vi.fn(),onTestConnection:vi.fn()};
async function secondary(name:string){if(!screen.queryByRole('tab',{name}))await userEvent.click(screen.getByRole('button',{name:'更多'}));await userEvent.click(screen.getByRole('tab',{name}));}
async function saveOnly(){await userEvent.click(screen.queryByRole('button',{name:'仅保存'})??screen.getByRole('button',{name:'保存'}));}
async function open(){await userEvent.click(screen.getByRole('button',{name:'Images'}));}
it('focuses an embedded connection opened directly from its saved URL selection',async()=>{
 render(<CompactConnectionWorkspace {...base} inlineEditor initialConnectionId="c"/>);
 const name=screen.getByRole('textbox',{name:'连接名称'});
 await waitFor(()=>expect(name).toHaveProperty('value','Images'));
 await waitFor(()=>expect(document.activeElement).toBe(name));
});
it('expands an embedded connection below its row and keeps the surrounding list visible',async()=>{
 render(<CompactConnectionWorkspace {...base} inlineEditor/>);
 await open();
 expect(screen.getByRole('button',{name:'Images'}).getAttribute('aria-expanded')).toBe('true');
 expect(screen.getByLabelText('查找已存连接')).toBeTruthy();
 expect(screen.getByRole('region',{name:'Images'}).contains(screen.getByLabelText('连接名称'))).toBe(true);
 await userEvent.click(screen.getByRole('button',{name:'Images'}));
 expect(screen.queryByLabelText('连接名称')).toBeNull();
 expect(screen.getByRole('button',{name:'Images'}).getAttribute('aria-expanded')).toBe('false');
});
it('guards switching between embedded rows and never drops the edited connection silently',async()=>{
 const other={...connection,id:'other',name:'Other images'};
 render(<CompactConnectionWorkspace {...base} inlineEditor connections={[connection,other]}/>);
 await open();fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'Unsaved name'}});
 await userEvent.click(screen.getByRole('button',{name:'Other images'}));
 expect(screen.getByRole('dialog',{name:'离开前处理修改'})).toBeTruthy();
 await userEvent.click(screen.getByRole('button',{name:'关闭确认，继续编辑'}));
 expect(screen.getByLabelText('连接名称')).toHaveProperty('value','Unsaved name');
 await userEvent.click(screen.getByRole('button',{name:'Other images'}));
 await userEvent.click(screen.getByRole('button',{name:'放弃修改并离开'}));
 expect(screen.getByLabelText('连接名称')).toHaveProperty('value','Other images');
 expect(screen.getByRole('button',{name:'Images'}).getAttribute('aria-expanded')).toBe('false');
});
it('keeps a just-created embedded connection editable before its parent list refreshes',async()=>{
 const create=vi.fn().mockResolvedValue({...connection,id:'created',name:'New embedded'});
 render(<CompactConnectionWorkspace {...base} inlineEditor connections={[]} onCreateConnection={create}/>);
 await userEvent.click(screen.getByRole('button',{name:'新建连接'}));
 fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'New embedded'}});
 fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'synthetic'}});
 await saveOnly();
 expect(await screen.findByRole('region',{name:'New embedded'})).toBeTruthy();
 expect(screen.getByLabelText('连接名称')).toHaveProperty('value','New embedded');
 expect(create).toHaveBeenCalledOnce();
});
it('replaces the list with one detail surface and saves metadata without testing or selecting a version',async()=>{const update=vi.fn(),test=vi.fn();render(<CompactConnectionWorkspace {...base} onUpdateConnection={update} onTestConnection={test}/>);await open();expect(screen.queryByLabelText('查找已存连接')).toBeNull();expect(screen.getAllByRole('tab')).toHaveLength(2);fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'New name'}});await saveOnly();await waitFor(()=>expect(update).toHaveBeenCalledExactlyOnceWith({connectionId:'c',name:'New name',description:''}));expect(test).not.toHaveBeenCalled();expect(screen.getByRole('status').textContent).toContain('需单独执行');});
it('retains a failed key rotation for retry without testing or exposing the key',async()=>{const rotate=vi.fn().mockRejectedValueOnce(Error('Temporary failure')).mockResolvedValue({...connection,current_version_id:'v3',status:'unverified'}),test=vi.fn();render(<CompactConnectionWorkspace {...base} onRotateConnection={rotate} onTestConnection={test}/>);await open();await userEvent.click(screen.getByRole('button',{name:'更换密钥'}));fireEvent.change(screen.getByLabelText('新的 API Key（选填）'),{target:{value:'synthetic-key'}});await saveOnly();expect((await screen.findByRole('alert')).textContent).toBe('Temporary failure');expect(screen.getByLabelText('新的 API Key（选填）')).toHaveProperty('value','synthetic-key');await saveOnly();await waitFor(()=>expect(rotate).toHaveBeenCalledTimes(2));expect(test).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain('synthetic-key');expect(screen.queryByLabelText('新的 API Key（选填）')).toBeNull();});
it('keeps model edits while switching tabs and saves them independently in the fixed pane',async()=>{const save=vi.fn(async input=>({...models,enabledModels:input.enabledModels,revision:'r2'})),test=vi.fn();render(<CompactConnectionWorkspace {...base} onTestConnection={test} onReadModels={async()=>models} onSaveModels={save}/>);await open();await userEvent.click(screen.getByRole('tab',{name:'模型'}));await userEvent.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));await secondary('记录');expect(screen.queryByRole('checkbox')).toBeNull();await userEvent.click(screen.getByRole('tab',{name:'模型'}));expect(screen.getByRole('checkbox',{name:'gpt-image-2'})).toHaveProperty('checked',false);await saveOnly();await waitFor(()=>expect(save).toHaveBeenCalledExactlyOnceWith({connectionId:'c',versionId:'v2',revision:'r1',enabledModels:[]}));expect(screen.getByRole('tab',{name:'模型'}).getAttribute('aria-selected')).toBe('true');expect(screen.queryByRole('dialog')).toBeNull();expect(test).not.toHaveBeenCalled();});
it('requires discard before leaving changed billing and clears credentials on tab change',async()=>{render(<CompactConnectionWorkspace {...base} onReadBilling={async()=>({connectionId:'c',provider:'openai',configured:false,revision:'r1',updatedAt:null})}/>);await open();await secondary('用量与计费');fireEvent.change(await screen.findByLabelText('OpenAI Admin API Key'),{target:{value:'synthetic-admin'}});await secondary('记录');expect(screen.getByRole('dialog',{name:'离开前处理修改'})).toBeTruthy();expect(screen.queryByRole('button',{name:'保留修改并离开'})).toBeNull();await userEvent.click(screen.getByRole('button',{name:/放弃修改并/}));await secondary('用量与计费');expect(await screen.findByLabelText('OpenAI Admin API Key')).toHaveProperty('value','');});
it('protects dirty navigation and cancels a new form without a second leave prompt',async()=>{let header!:ConnectionSettingsHeader;render(<CompactConnectionWorkspace {...base} onHeaderChange={value=>header=value}/>);await open();fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'Edited'}});act(()=>header.back?.());expect(screen.getByRole('dialog',{name:'离开前处理修改'})).toBeTruthy();await userEvent.click(screen.getByRole('button',{name:/放弃修改并/}));await userEvent.click(screen.getByRole('button',{name:'新建连接'}));fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'Draft'}});await userEvent.click(screen.getByRole('button',{name:'取消'}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByLabelText('查找已存连接')).toBeTruthy();});
it('preserves immutable version identity and does not revoke without recorded reference impact',async()=>{const revoke=vi.fn(),rebind=vi.fn();render(<CompactConnectionWorkspace {...base} onRevokeVersion={revoke} onRebindVersion={rebind}/>);await open();await secondary('记录');await userEvent.click(screen.getByRole('button',{name:'查看版本 1'}));expect(screen.getByText('历史版本')).toBeTruthy();fireEvent.change(screen.getByLabelText('恢复认证材料'),{target:{value:'synthetic-historical'}});await userEvent.click(screen.getByRole('button',{name:'重新绑定此版本'}));await waitFor(()=>expect(rebind).toHaveBeenCalledExactlyOnceWith('v1','synthetic-historical'));await userEvent.click(screen.getByRole('button',{name:'撤销版本'}));expect(screen.getByRole('button',{name:'确认撤销 v1'})).toHaveProperty('disabled',true);expect(revoke).not.toHaveBeenCalled();});
it('separates MiniMax site changes from test, retaining original version in the region request',async()=>{const change=vi.fn().mockResolvedValue({...connection,provider:'minimax',adapter:'minimax_video',region:'cn',current_version_id:'v3'});render(<CompactConnectionWorkspace {...base} connections={[{...connection,provider:'minimax',adapter:'minimax_video',region:'international'}]} onChangeRegion={change}/>);await open();fireEvent.change(screen.getByLabelText('MiniMax 站点'),{target:{value:'cn'}});await saveOnly();await waitFor(()=>expect(change).toHaveBeenCalledExactlyOnceWith({connectionId:'c',versionId:'v2',region:'cn'}));expect(base.onTestConnection).not.toHaveBeenCalled();});
it('rejects metadata edits after an external version change rather than writing a stale draft',async()=>{const update=vi.fn(),view=render(<CompactConnectionWorkspace {...base} onUpdateConnection={update}/>);await open();fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'Edited'}});view.rerender(<CompactConnectionWorkspace {...base} connections={[{...connection,current_version_id:'v3'}]} onUpdateConnection={update}/>);await saveOnly();expect(screen.getByRole('alert').textContent).toContain('连接资料已变化');expect(update).not.toHaveBeenCalled();expect(screen.getByLabelText('连接名称')).toHaveProperty('value','Edited');});
it('blocks duplicate writes and ignores a late result after unmount',async()=>{let finish!:(value:ExternalConnection)=>void;const rotate=vi.fn(()=>new Promise<ExternalConnection>(resolve=>finish=resolve)),header=vi.fn();const view=render(<CompactConnectionWorkspace {...base} onHeaderChange={header} onRotateConnection={rotate}/>);await open();await userEvent.click(screen.getByRole('button',{name:'更换密钥'}));fireEvent.change(screen.getByLabelText('新的 API Key（选填）'),{target:{value:'synthetic'}});const save=screen.getByRole('button',{name:'仅保存'});fireEvent.click(save);fireEvent.click(save);expect(rotate).toHaveBeenCalledOnce();view.unmount();header.mockClear();await act(async()=>finish({...connection,name:'Late'}));expect(header).not.toHaveBeenCalled();});
it('does not offer reveal/copy without the explicit secret administration capability',async()=>{render(<CompactConnectionWorkspace {...base}/>);await open();expect(screen.queryByRole('button',{name:'查看密钥'})).toBeNull();expect(screen.queryByRole('button',{name:'复制密钥'})).toBeNull();await secondary('记录');await userEvent.click(screen.getByRole('button',{name:'查看版本 2'}));expect(screen.queryByRole('button',{name:'查看历史密钥'})).toBeNull();expect(screen.getByText(/蓝图 1/)).toBeTruthy();});
it.each([{adapter:'wan_video',provider:'bailian',expected:JSON.stringify({apiKey:'synthetic',workspaceId:'workspace-1'})},{adapter:'minimax_video',provider:'minimax',expected:JSON.stringify({apiKey:'synthetic',region:'cn'})},{adapter:'kling_video',provider:'kling',expected:'  synthetic  '}])('preserves $provider credential encoding and saves without implicitly testing',async({adapter,provider,expected})=>{const create=vi.fn().mockResolvedValue({...connection,id:'created'}),test=vi.fn();render(<CompactConnectionWorkspace {...base} connections={[]} onCreateConnection={create} onTestConnection={test}/>);await userEvent.click(screen.getByRole('button',{name:'新建连接'}));fireEvent.change(screen.getByLabelText('连接类型'),{target:{value:adapter}});fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'New connection'}});if(provider==='bailian')fireEvent.change(screen.getByLabelText('百炼业务空间 ID'),{target:{value:' workspace-1 '}});fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'  synthetic  '}});await saveOnly();await waitFor(()=>expect(create).toHaveBeenCalledExactlyOnceWith({name:'New connection',provider,adapter,secret:expected}));expect(test).not.toHaveBeenCalled();});
it('renders a never-visited model pane after discarding billing edits and retains unrelated connection edits',async()=>{render(<CompactConnectionWorkspace {...base} onUpdateConnection={vi.fn()} onReadModels={async()=>models} onReadBilling={async()=>({connectionId:'c',provider:'openai',configured:false,revision:'r1',updatedAt:null})}/>);await open();fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'Keep this name'}});await secondary('用量与计费');fireEvent.change(await screen.findByLabelText('OpenAI Admin API Key'),{target:{value:'synthetic'}});await userEvent.click(screen.getByRole('tab',{name:'模型'}));await userEvent.click(screen.getByRole('button',{name:'放弃修改并离开'}));expect(await screen.findByRole('checkbox',{name:'gpt-image-2'})).toBeTruthy();await userEvent.click(screen.getByRole('tab',{name:'连接'}));expect(screen.getByLabelText('连接名称')).toHaveProperty('value','Keep this name');});
it('forgets model drafts explicitly discarded on returning to the list',async()=>{let header!:ConnectionSettingsHeader;render(<CompactConnectionWorkspace {...base} onHeaderChange={value=>header=value} onReadModels={async()=>models}/>);await open();await userEvent.click(screen.getByRole('tab',{name:'模型'}));await userEvent.click(await screen.findByRole('checkbox',{name:'gpt-image-2'}));act(()=>header.back?.());await userEvent.click(screen.getByRole('button',{name:'放弃修改并离开'}));await open();await userEvent.click(screen.getByRole('tab',{name:'模型'}));expect(await screen.findByRole('checkbox',{name:'gpt-image-2'})).toHaveProperty('checked',true);});
it('protects unsaved historical rebind credentials on both tab change and history back',async()=>{let header!:ConnectionSettingsHeader;render(<CompactConnectionWorkspace {...base} onHeaderChange={value=>header=value} onRebindVersion={vi.fn()}/>);await open();await secondary('记录');await userEvent.click(screen.getByRole('button',{name:'查看版本 1'}));fireEvent.change(screen.getByLabelText('恢复认证材料'),{target:{value:'synthetic'}});await userEvent.click(screen.getByRole('tab',{name:'连接'}));expect(screen.getByRole('dialog',{name:'离开前处理修改'})).toBeTruthy();await userEvent.click(screen.getByRole('button',{name:'关闭确认，继续编辑'}));expect(screen.getByLabelText('恢复认证材料')).toHaveProperty('value','synthetic');act(()=>header.back?.());expect(screen.getByRole('dialog',{name:'离开前处理修改'})).toBeTruthy();await userEvent.click(screen.getByRole('button',{name:'放弃修改并离开'}));expect(screen.queryByLabelText('恢复认证材料')).toBeNull();expect(screen.getByRole('button',{name:'查看版本 1'})).toBeTruthy();});
it('requires an explicit MiniMax site before rotating a legacy key with unknown site',async()=>{const rotate=vi.fn();render(<CompactConnectionWorkspace {...base} connections={[{...connection,provider:'minimax',adapter:'minimax_video',endpoint:'',region:undefined}]} onRotateConnection={rotate}/>);await open();expect(screen.getByLabelText('MiniMax 站点')).toHaveProperty('value','');await userEvent.click(screen.getByRole('button',{name:'更换密钥'}));fireEvent.change(screen.getByLabelText('新的 API Key（选填）'),{target:{value:'synthetic'}});await saveOnly();expect(rotate).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('MiniMax 站点'),{target:{value:'cn'}});await saveOnly();await waitFor(()=>expect(rotate).toHaveBeenCalledExactlyOnceWith({connectionId:'c',provider:'minimax',adapter:'minimax_video',secret:JSON.stringify({apiKey:'synthetic',region:'cn'})}));});

it('saves a credential once and retains the saved version when verification fails',async()=>{
 const saved={...connection,id:'created',current_version_id:'v3',status:'unverified'} as ExternalConnection;
 const create=vi.fn().mockResolvedValue(saved),test=vi.fn().mockRejectedValue(Error('Authentication failed'));
 render(<CompactConnectionWorkspace {...base} connections={[]} onCreateConnection={create} onTestConnection={test}/>);
 await userEvent.click(screen.getByRole('button',{name:'新建连接'}));
 fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'New service'}});
 fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'synthetic-key'}});
 await userEvent.click(screen.getByRole('button',{name:'保存并验证'}));
 await waitFor(()=>expect(test).toHaveBeenCalledExactlyOnceWith('created'));
 expect(screen.getByRole('alert').textContent).toContain('已保存');
 expect(create).toHaveBeenCalledOnce();expect(screen.queryByLabelText('API Key')).toBeNull();
});
it('filters setup by capability and requires an explicit compatible service choice',async()=>{
 const use=vi.fn();render(<CompactConnectionWorkspace {...base} setupCapability="image" onUseConnection={use}/>);
 expect(screen.queryByRole('button',{name:'搜索'})).toBeNull();
 await open();expect(use).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'使用此服务并返回'}));
 expect(use).toHaveBeenCalledWith({connectionId:'c',versionId:'v2',modelId:'gpt-image-2'});
});

it('discloses speech test cost and offers save only without synthesizing',async()=>{
 const create=vi.fn().mockResolvedValue({...connection,id:'speech-created',provider:'volcengine_tts',adapter:'volcengine_tts'}),test=vi.fn();
 render(<CompactConnectionWorkspace {...base} connections={[]} setupCapability="speech" onCreateConnection={create} onTestConnection={test}/>);
 await userEvent.click(screen.getByRole('button',{name:'新建连接'}));
 expect(screen.getByLabelText('连接类型')).toHaveProperty('value','volcengine_tts');
 fireEvent.change(screen.getByLabelText('连接名称'),{target:{value:'Speech'}});fireEvent.change(screen.getByLabelText('API Key'),{target:{value:'synthetic'}});
 expect(screen.getByText(/测试会实际合成一小段语音/).textContent).toContain('可能消耗服务额度');
 expect(screen.getByRole('button',{name:'保存并测试语音'})).toBeTruthy();await saveOnly();
 await waitFor(()=>expect(create).toHaveBeenCalledOnce());expect(test).not.toHaveBeenCalled();
});
it('hides meaningless save actions in history and unsupported billing',async()=>{
 render(<CompactConnectionWorkspace {...base}/>);await open();await secondary('记录');
 expect(screen.queryByRole('button',{name:'保存'})).toBeNull();await secondary('用量与计费');
 expect(screen.getByText('此服务没有可用的账务接口。')).toBeTruthy();expect(screen.queryByRole('button',{name:'保存'})).toBeNull();
});

it('locks explicit service return and keeps a failed return visible for correction',async()=>{
 let reject!:(cause:Error)=>void;const use=vi.fn(()=>new Promise<void>((_resolve,fail)=>reject=fail));
 render(<CompactConnectionWorkspace {...base} setupCapability="image" onUseConnection={use}/>);await open();
 const button=screen.getByRole('button',{name:'使用此服务并返回'});fireEvent.click(button);fireEvent.click(button);
 expect(use).toHaveBeenCalledOnce();expect(button).toHaveProperty('disabled',true);
 await act(async()=>reject(Error('所选服务或模型已变化，请重新核对制作服务。')));
 expect(screen.getByRole('alert').textContent).toContain('已变化');expect(screen.getByLabelText('连接名称')).toHaveProperty('value','Images');
 expect(button).toHaveProperty('disabled',false);
});
