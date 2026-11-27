import {cleanup,render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
const {request,modelCommand}=vi.hoisted(()=>({request:vi.fn(),modelCommand:vi.fn()}));
vi.mock('./client',()=>({localRequest:(path:string,init?:RequestInit)=>path==='script-studio'?Promise.resolve(JSON.parse(String(init?.body)).command==='conversations'?{conversations:[]}:{turns:[],result:null,mode:'optimize'}):request(path,init),localCommand:modelCommand}));
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
import {WorkspaceDraftProvider} from './WorkspaceDraft';
const source='一个人推门走进咖啡馆，坐下等朋友。';
const plan={title:'等待',durationSeconds:15,summary:'用空座位表现等待。',sourceUse:'原文按画面描述处理。',settings:[],narrationEnabled:false,captionsEnabled:false,shots:[{title:'进入',durationSeconds:5,narration:'',subtitle:null,visual:'人物走进咖啡馆。',videoPrompt:'跟随人物进入。',camera:'中景跟拍',visualSource:'unassigned',settings:[]},{title:'等待',durationSeconds:10,narration:'',subtitle:null,visual:'人物落座，望向空座位。',videoPrompt:'固定镜头停留在空座位。',camera:'固定近景',visualSource:'unassigned',settings:[]}],changes:[],warnings:[],canProceed:true};
const catalog={serviceCatalog:{version:1,groups:[{capability:'language_model',services:[{id:'s',connectionVersionId:'c',connectionName:'GPT',provider:'openai',adapter:'openai_responses',models:['gpt-5.6-luna'],executable:true}]}]}};
function panel(extra:Record<string,unknown>={}){const command=vi.fn(async(name:string)=>name==='confirmScriptStudio'?{id:'saved'}:{main_script_revision_id:'saved',stage:'script_approved'}),done=vi.fn();const props={episodeId:'episode',scriptRevisionId:null,script:source,stage:'waiting_input',readOnly:false,pending:false,command,onConfirmed:done,...extra};return{...render(<WorkspaceScriptPanel {...props}/>),command,done,props};}
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();});
it('continues arbitrary original text with one save and start, without a model or required revision reason',async()=>{
 const text='# 随手写的画面\n\n人物进入咖啡馆。\n\n坐下等朋友。',{command,done}=panel({script:text});
 fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());
 expect(command.mock.calls).toEqual([['confirmScriptStudio',expect.objectContaining({text,targetDuration:null,reason:'',expectedScriptRevisionId:null})],['start',{episodeId:'episode'}]]);expect(modelCommand).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByRole('group',{name:'脚本字数'})).toBeNull();
});
it('requests one recommended plan and adopts it once while keeping the exact source',async()=>{
 request.mockResolvedValue(catalog);modelCommand.mockResolvedValue({requestId:'plan-request',status:'completed',plan});const{command,done}=panel();
 fireEvent.change(screen.getByLabelText('目标时长'),{target:{value:'15'}});fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));
 await screen.findByRole('button',{name:'采用并继续'});expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value',source);expect(command).not.toHaveBeenCalled();expect(modelCommand).toHaveBeenCalledExactlyOnceWith('optimize',expect.objectContaining({text:source,targetDuration:15,mode:'optimize',instruction:''}),undefined,'script-studio');
 fireEvent.click(screen.getByRole('button',{name:'采用并继续'}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(command).toHaveBeenCalledWith('confirmScriptStudio',expect.objectContaining({text:source,targetDuration:15,requestId:'plan-request'}));expect(screen.queryByRole('button',{name:'确认识别结果'})).toBeNull();expect(screen.queryByRole('dialog')).toBeNull();
});
it('invalidates an AI plan when the source or target duration changes',async()=>{
 request.mockResolvedValue(catalog);modelCommand.mockResolvedValue({requestId:'plan-request',status:'completed',plan});const{command}=panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});
 fireEvent.change(screen.getByRole('textbox',{name:'脚本正文'}),{target:{value:source+'保留一镜到底。'}});expect(screen.queryByRole('button',{name:'采用并继续'})).toBeNull();expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});fireEvent.change(screen.getByLabelText('目标时长'),{target:{value:'20'}});expect(screen.queryByRole('button',{name:'采用并继续'})).toBeNull();
});
it('shows required input and duration errors at the field before dispatching',async()=>{
 const{command}=panel({script:''});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));expect(screen.getByRole('alert').textContent).toContain('请填写');expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'脚本正文'}));fireEvent.change(screen.getByRole('textbox',{name:'脚本正文'}),{target:{value:source}});fireEvent.change(screen.getByLabelText('目标时长'),{target:{value:'-5'}});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));expect(document.activeElement).toBe(screen.getByLabelText('目标时长'));expect(command).not.toHaveBeenCalled();expect(modelCommand).not.toHaveBeenCalled();
});
it('ignores a model result received after editing the original source',async()=>{
 request.mockResolvedValue(catalog);let finish!:(value:unknown)=>void;modelCommand.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await waitFor(()=>expect(modelCommand).toHaveBeenCalledOnce());fireEvent.change(screen.getByRole('textbox',{name:'脚本正文'}),{target:{value:'另一份原文'}});await act(async()=>finish({requestId:'late',status:'completed',plan}));expect(screen.queryByRole('button',{name:'采用并继续'})).toBeNull();expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','另一份原文');expect(screen.queryByRole('complementary',{name:'分镜预览'})).toBeNull();
});
it('restores unsent original text and target duration only for the same Owner and revision',()=>{
 const props={episodeId:'draft-e',scriptRevisionId:null,script:'',stage:'waiting_input',readOnly:false,pending:false,command:vi.fn(),onConfirmed:vi.fn()};const view=render(<WorkspaceDraftProvider ownerId="owner-a"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);fireEvent.change(screen.getByRole('textbox',{name:'脚本正文'}),{target:{value:source}});fireEvent.change(screen.getByLabelText('目标时长'),{target:{value:'15'}});view.unmount();const restored=render(<WorkspaceDraftProvider ownerId="owner-a"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value',source);expect(screen.getByLabelText('目标时长')).toHaveProperty('value','15');expect(document.querySelector('.workspace-script-restored')).toBeNull();expect(screen.getByRole('region',{name:'通知'}).textContent).toContain('已恢复草稿');restored.unmount();render(<WorkspaceDraftProvider ownerId="owner-b"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','');
});
it('sends requested changes against the current plan without standalone adaptation',async()=>{
 request.mockResolvedValue(catalog);modelCommand.mockResolvedValue({requestId:'plan-request',status:'completed',plan}).mockResolvedValueOnce({requestId:'plan-request',status:'completed',plan}).mockResolvedValueOnce({requestId:'updated-request',status:'completed',plan});panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});
 fireEvent.change(screen.getByRole('textbox',{name:'修改要求'}),{target:{value:'保留单镜头'}});fireEvent.submit(screen.getByRole('form',{name:'拍法对话'}));await waitFor(()=>expect(modelCommand).toHaveBeenCalledTimes(2));expect(modelCommand).toHaveBeenLastCalledWith('optimize',expect.objectContaining({mode:'optimize',instruction:'保留单镜头',previousRequestId:'plan-request'}),undefined,'script-studio');expect(screen.getByRole('list',{name:'拍法对话记录'}).textContent).toContain('保留单镜头');
 expect(screen.queryByRole('checkbox',{name:'允许大胆改编'})).toBeNull();expect(modelCommand).toHaveBeenCalledTimes(2);
});
it('offers a model choice before the first paid call when multiple models are available',async()=>{
 const first=catalog.serviceCatalog.groups[0].services[0];request.mockResolvedValue({serviceCatalog:{version:1,groups:[{capability:'language_model',services:[first,{...first,id:'second',connectionVersionId:'second-version',connectionName:'第二个模型'}]}]}});modelCommand.mockResolvedValue({requestId:'plan-request',status:'completed',plan});panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByText('请选择模型，再生成拍法。');expect(modelCommand).not.toHaveBeenCalled();fireEvent.click(await screen.findByRole('button',{name:/第二个模型/}));fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});expect(modelCommand).toHaveBeenCalledExactlyOnceWith('optimize',expect.objectContaining({selection:expect.objectContaining({connectionVersionId:'second-version'})}),undefined,'script-studio');
});
it('shows narration and captions only on the individual shots where they are enabled',async()=>{
 request.mockResolvedValue(catalog);const mixed={...plan,narrationEnabled:true,captionsEnabled:true,shots:plan.shots.map((shot,index)=>({...shot,narration:index?'可读台词':'关闭镜头的台词',subtitle:index?'可见字幕':'关闭镜头的字幕',settings:index?[]:[{field:'口播启用',value:'关闭'},{field:'字幕',value:'关闭'}]}))};modelCommand.mockResolvedValue({requestId:'mixed',status:'completed',plan:mixed});panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});expect(screen.queryByText('口播：关闭镜头的台词')).toBeNull();expect(screen.queryByText('字幕：关闭镜头的字幕')).toBeNull();expect(screen.getByText('口播：可读台词')).toBeTruthy();expect(screen.getByText('字幕：可见字幕')).toBeTruthy();
});
it('previews the actual caption text when captions follow narration rather than an explicit subtitle',async()=>{
 request.mockResolvedValue(catalog);const follow={...plan,narrationEnabled:true,captionsEnabled:true,shots:plan.shots.map((shot,index)=>({...shot,narration:index?'原句二':'原句一',subtitle:null}))};modelCommand.mockResolvedValue({requestId:'follow',status:'completed',plan:follow});panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});expect(screen.getByText('字幕：原句一')).toBeTruthy();expect(screen.getByText('字幕：原句二')).toBeTruthy();
});

it('keeps both example presets in the source header without submitting or calling a model',async()=>{
 const{container,command}=panel();const examples=screen.getByRole('button',{name:'使用示例'});expect(container.querySelector('.script-studio-input-heading')?.contains(examples)).toBe(true);
 fireEvent.click(examples);fireEvent.click(await screen.findByRole('button',{name:'普通文本'}));expect(screen.getByLabelText('目标时长')).toHaveProperty('value','15');
 fireEvent.click(examples);fireEvent.click(await screen.findByRole('button',{name:'完整分镜'}));expect(screen.getByRole('textbox',{name:'脚本正文'}).textContent).toContain('# ');expect(screen.getByLabelText('目标时长')).toHaveProperty('value','15');expect(command).not.toHaveBeenCalled();expect(modelCommand).not.toHaveBeenCalled();
});
it('keeps the preview hidden during text-only discussion',async()=>{
 request.mockResolvedValue(catalog);
 let finish!:(result:unknown)=>void;
 modelCommand.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 panel();
 fireEvent.click(screen.getByRole('button',{name:'交流方式：调整拍法'}));
 fireEvent.click(await screen.findByRole('button',{name:'自由交流'}));
 fireEvent.click(screen.getByRole('button',{name:'关闭'}));
 fireEvent.change(await screen.findByRole('textbox',{name:'修改要求'}),{target:{value:'这个故事适合什么风格？'}});
 fireEvent.click(screen.getByRole('button',{name:'发送'}));
 await waitFor(()=>expect(modelCommand).toHaveBeenCalledWith('optimize',expect.objectContaining({mode:'discuss'}),undefined,'script-studio'));
 expect(screen.queryByRole('complementary',{name:'分镜预览'})).toBeNull();
 await act(async()=>finish({requestId:'discussion',status:'completed',message:'可以尝试纪实风格。'}));
 expect(screen.queryByRole('complementary',{name:'分镜预览'})).toBeNull();
});

it('reveals loading only after optimization and keeps collapse controls with the shots',async()=>{
 request.mockResolvedValue(catalog);let finish!:(value:unknown)=>void;modelCommand.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const{container,command}=panel();expect(screen.queryByRole('complementary',{name:'分镜预览'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await waitFor(()=>expect(modelCommand).toHaveBeenCalledOnce());expect(screen.getByRole('status',{name:'拍法生成进度'})).toBeTruthy();
 await act(async()=>finish({requestId:'plan-request',status:'completed',plan}));const collapse=screen.getByRole('button',{name:'收起分镜'});expect(container.querySelector('.script-studio-middle')?.contains(collapse)).toBe(true);expect(container.querySelector('.script-studio-chat')?.contains(collapse)).toBe(false);
 fireEvent.click(collapse);expect(screen.queryByRole('region',{name:'推荐拍法'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'展开分镜'}));expect(screen.getByRole('region',{name:'推荐拍法'})).toBeTruthy();expect(command).not.toHaveBeenCalled();
});
it('never dispatches an empty refinement or submits a plan through the source form',async()=>{
 request.mockResolvedValue(catalog);modelCommand.mockResolvedValue({requestId:'plan-request',status:'completed',plan});const{command}=panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});
 fireEvent.submit(screen.getByRole('form',{name:'拍法对话'}));expect(modelCommand).toHaveBeenCalledOnce();fireEvent.submit(screen.getByRole('form',{name:'脚本正文'}));expect(command).not.toHaveBeenCalled();
});

it('shows a sole or remembered model before dispatch and never defaults to the first of several models',async()=>{
 request.mockResolvedValue(catalog);const view=panel();await waitFor(()=>expect(screen.getByRole('button',{name:'选择大语言模型'}).textContent).toContain('gpt-5.6-luna'));expect(modelCommand).not.toHaveBeenCalled();view.unmount();
 const first=catalog.serviceCatalog.groups[0].services[0];request.mockResolvedValue({serviceCatalog:{version:1,groups:[{capability:'language_model',services:[first,{...first,id:'other',models:['deepseek-flash']}]}]}});panel();await waitFor(()=>expect(screen.getByRole('button',{name:'选择大语言模型'}).textContent).toContain('选择模型'));fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('dialog',{name:'选择大语言模型'});expect(screen.queryByRole('searchbox')).toBeNull();expect(modelCommand).not.toHaveBeenCalled();
});
it('saves shot text through a bound manual receipt and adopts the edited receipt without rewriting the source',async()=>{
 request.mockResolvedValue(catalog);modelCommand.mockResolvedValueOnce({requestId:'plan-request',status:'completed',plan}).mockResolvedValueOnce({requestId:'manual-request',status:'completed',modifiedShotIndexes:[0],plan:{...plan,changes:['手动修订'],shots:plan.shots.map((shot,index)=>index?shot:{...shot,visual:'新的画面描述'})}});const{command}=panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});fireEvent.click(screen.getByRole('button',{name:'第 1 个镜头操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'编辑文字'}));expect(screen.getByRole('button',{name:'采用并继续'})).toHaveProperty('disabled',true);fireEvent.change(screen.getByRole('textbox',{name:'画面'}),{target:{value:'新的画面描述'}});fireEvent.click(screen.getByRole('button',{name:'保存镜头修改'}));await waitFor(()=>expect(screen.queryByRole('form',{name:'编辑镜头文字'})).toBeNull());expect(modelCommand).toHaveBeenLastCalledWith('editShot',expect.objectContaining({text:source,previousRequestId:'plan-request',index:0,fields:{visual:'新的画面描述'}}),undefined,'script-studio');expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value',source);await waitFor(()=>expect(screen.getByRole('button',{name:'采用并继续'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'采用并继续'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('confirmScriptStudio',expect.objectContaining({requestId:'manual-request',text:source})));
});

it('displays the remembered Owner model before the first optimization',async()=>{
 const first=catalog.serviceCatalog.groups[0].services[0];localStorage.setItem('loop-control.script-studio-model:remembered-owner','second:deepseek-flash');request.mockResolvedValue({serviceCatalog:{version:1,groups:[{capability:'language_model',services:[first,{...first,id:'second',connectionVersionId:'deepseek-version',provider:'deepseek',adapter:'deepseek_responses',models:['deepseek-flash'],connectionName:'DeepSeek'}]}]}});modelCommand.mockResolvedValue({requestId:'remembered-plan',status:'completed',plan});render(<WorkspaceDraftProvider ownerId="remembered-owner"><WorkspaceScriptPanel episodeId="remembered" scriptRevisionId={null} script={source} stage="waiting_input" readOnly={false} pending={false} command={vi.fn()} onConfirmed={vi.fn()}/></WorkspaceDraftProvider>);await waitFor(()=>expect(screen.getByRole('button',{name:'选择大语言模型'}).textContent).toContain('deepseek-flash'));expect(modelCommand).not.toHaveBeenCalled();await waitFor(()=>expect(screen.getByRole('button',{name:'优化拍法'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});expect(modelCommand).toHaveBeenCalledWith('optimize',expect.objectContaining({selection:expect.objectContaining({connectionVersionId:'deepseek-version',model:'deepseek-flash'})}),undefined,'script-studio');
});
it('retains unsaved shot edits after a rejected save and cancels back to the original receipt',async()=>{
 request.mockResolvedValue(catalog);modelCommand.mockResolvedValueOnce({requestId:'plan-request',status:'completed',plan}).mockRejectedValueOnce(Error('修改未通过验证。'));const{command}=panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});fireEvent.click(screen.getByRole('button',{name:'第 1 个镜头操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'编辑文字'}));fireEvent.change(screen.getByRole('textbox',{name:'画面'}),{target:{value:'尚未保存的画面'}});fireEvent.click(screen.getByRole('button',{name:'保存镜头修改'}));await screen.findByText('修改未通过验证。');expect(screen.getByRole('textbox',{name:'画面'})).toHaveProperty('value','尚未保存的画面');expect(screen.getByRole('button',{name:'采用并继续'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'取消编辑'}));await waitFor(()=>expect(screen.getByRole('button',{name:'采用并继续'})).toHaveProperty('disabled',false));expect(screen.getByRole('region',{name:'推荐拍法'}).textContent).not.toContain('尚未保存的画面');expect(command).not.toHaveBeenCalled();
});

it('uses an overflow menu, marks only edited shots and keeps change details in the explanation',async()=>{
 request.mockResolvedValue(catalog);modelCommand.mockResolvedValue({requestId:'marked',status:'completed',modifiedShotIndexes:[1],plan:{...plan,changes:['包含手动修订']}});const{container}=panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});const shots=container.querySelectorAll('.script-studio-shots>li');expect(shots[0].textContent).not.toContain('已修改');expect(shots[1].textContent).toContain('已修改');expect(screen.queryByText('内容变化')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'第 2 个镜头操作'}));expect(screen.getByRole('menuitem',{name:'编辑文字'})).toBeTruthy();expect(screen.getByRole('menuitem',{name:'删除镜头'})).toBeTruthy();
});
it('confirms shot deletion without calling a model, retains the source and adopts the new receipt',async()=>{
 request.mockResolvedValue(catalog);modelCommand.mockResolvedValueOnce({requestId:'base',status:'completed',plan}).mockResolvedValueOnce({requestId:'deleted',status:'completed',modifiedShotIndexes:[0],plan:{...plan,changes:['删除第二镜'],shots:[{...plan.shots[0],durationSeconds:15}]}});const{command}=panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});fireEvent.click(screen.getByRole('button',{name:'第 2 个镜头操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'删除镜头'}));expect(screen.getByRole('dialog',{name:'删除镜头'}).textContent).toContain('总时长仍为 15 秒');expect(command).not.toHaveBeenCalled();expect(modelCommand).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(modelCommand).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'第 2 个镜头操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'删除镜头'}));fireEvent.click(screen.getByRole('button',{name:'删除镜头'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'删除镜头'})).toBeNull());expect(modelCommand).toHaveBeenLastCalledWith('deleteShot',expect.objectContaining({previousRequestId:'base',index:1,text:source}),undefined,'script-studio');expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value',source);fireEvent.click(screen.getByRole('button',{name:'第 1 个镜头操作'}));expect(screen.getByRole('menuitem',{name:'删除镜头'}).getAttribute('aria-disabled')).toBe('true');screen.getByRole('menu',{name:'第 1 个镜头操作'}).focus();await userEvent.keyboard('{Escape}');fireEvent.click(await screen.findByRole('button',{name:'采用并继续'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('confirmScriptStudio',expect.objectContaining({requestId:'deleted'})));
});
it('keeps the deletion confirmation and old plan after a failed request',async()=>{
 request.mockResolvedValue(catalog);modelCommand.mockResolvedValueOnce({requestId:'base',status:'completed',plan}).mockRejectedValueOnce(Error('删除未完成'));const{command}=panel();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});fireEvent.click(screen.getByRole('button',{name:'第 1 个镜头操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'删除镜头'}));fireEvent.click(screen.getByRole('button',{name:'删除镜头'}));await screen.findByText('删除未完成');expect(screen.getByRole('dialog',{name:'删除镜头'})).toBeTruthy();expect(screen.getByRole('button',{name:'采用并继续'})).toHaveProperty('disabled',true);expect(command).not.toHaveBeenCalled();
});

it('places the accessible upload icon in the source header and keeps the native script import path',async()=>{
 request.mockResolvedValue(catalog);const{container,command}=panel(),upload=screen.getByRole('button',{name:'上传脚本'}),input=screen.getByLabelText('导入主脚本文件');
 expect(container.querySelector('.script-studio-input-heading')?.contains(upload)).toBe(true);expect(screen.getByRole('toolbar',{name:'脚本工具'}).contains(upload)).toBe(false);expect(upload.textContent).toBe('');
 const click=vi.spyOn(input,'click');fireEvent.click(upload);expect(click).toHaveBeenCalledOnce();
 const file=new File(['# 导入正文'],'scene.md',{type:'text/markdown'});Object.defineProperty(file,'text',{value:async()=>'# 导入正文'});fireEvent.change(input,{target:{files:[file]}});
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','# 导入正文'));expect(command).not.toHaveBeenCalled();expect(modelCommand).not.toHaveBeenCalled();
});


it('uploads a 策稿 handoff as its validated v3 storyboard without starting or calling a model',async()=>{
 request.mockResolvedValue(catalog);const {command}=panel();
 const body=`# 两镜

## 制作设置
- 模板版本：3
- 画幅：9:16
- 口播启用：关闭
- 字幕：开启
- 字幕正文模式：independent

## 正文
### 段落 01
- 口播：
- 字幕正文：First look.
- 画面来源：已有素材
- 素材名称：front.png
- 镜头时长（秒）：2
- 画面提示：全景。
### 段落 02
- 口播：
- 字幕正文：See the detail.
- 画面来源：已有素材
- 素材名称：front.png
- 镜头时长（秒）：3
- 画面提示：细节。`;
 const envelope=`---
schema: "loop-control-handoff/v1"
handoff_id: "demo-stand-sg-001"
revision: 2
product_id: "P01"
title: "两镜"
product_images:
  - "images/front.png"
---

## 脚本

${body}

## 商品事实

- 仅为合成示意。`;
 function upload(text:string){const file=new File([text],'script.md',{type:'text/markdown'});Object.defineProperty(file,'text',{value:async()=>text});fireEvent.change(screen.getByLabelText('导入主脚本文件'),{target:{files:[file]}});}
 upload(envelope.replace('素材名称：front.png','素材名称：absent.png'));
 await screen.findByText(/absent\.png/);expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value',source);
 fireEvent.change(screen.getByLabelText('目标时长'),{target:{value:'15'}});
 upload(envelope);await waitFor(()=>expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value',body));
 expect(screen.getByLabelText('目标时长')).toHaveProperty('value','');
 expect(command).not.toHaveBeenCalled();expect(modelCommand).not.toHaveBeenCalled();
});
