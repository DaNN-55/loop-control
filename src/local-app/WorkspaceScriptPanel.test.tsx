import {render,screen,fireEvent,cleanup,waitFor,within,act} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('./client',async importOriginal=>({...await importOriginal<typeof import('./client')>(),localRequest:request}));
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
import {WorkspaceDraftProvider} from './WorkspaceDraft';
const retained=new Map<string,{sourceText:string;targetDuration:number|null}>();
beforeEach(()=>{request.mockImplementation(async(path:string)=>{if(path.startsWith('script-studio?')){const query=new URLSearchParams(path.split('?')[1]);return retained.get(query.get('episodeId')+':'+query.get('scriptRevisionId'))??{sourceText:'原文',targetDuration:null};}throw Error('Unexpected local read: '+path);});});
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();retained.clear();vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllGlobals();});
function panel(extra:Partial<Parameters<typeof WorkspaceScriptPanel>[0]>={}){
 const command=vi.fn(async(_name:string,_data:unknown)=>({id:'saved'})),confirmed=vi.fn();
 const props={episodeId:'e',scriptRevisionId:null,script:'',stage:'waiting_input',readOnly:false,pending:false,command,onConfirmed:confirmed,...extra};
 if(props.scriptRevisionId)retained.set(props.episodeId+':'+props.scriptRevisionId,{sourceText:props.script,targetDuration:null});
 return{...render(<WorkspaceScriptPanel {...props}/>),props,command,confirmed};
}
async function editable(){const input=await screen.findByRole('textbox',{name:'脚本正文'});await waitFor(()=>expect(input).toHaveProperty('disabled',false));return input;}
async function revise(value:string){fireEvent.change(await editable(),{target:{value}});}
function notes(){fireEvent.click(screen.getByText('历史',{selector:'summary'}));return screen.getByRole('textbox',{name:'修订备注（选填）'});}
function startFailure(command:(name:string,data:unknown)=>Promise<unknown>,confirmed=vi.fn()){
 const view=panel({command,onConfirmed:confirmed});fireEvent.change(screen.getByRole('textbox',{name:'脚本正文'}),{target:{value:'恢复正文'}});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));return{...view,confirmed};
}
function episodeRead(stage='waiting_input',revision='saved'){return{sections:{episode:{id:'e',main_script_revision_id:revision,stage,archived_at:null},historicalReadOnly:false}};}
it('confirms exact original text once and starts production without locking the editor or adding a second approval',async()=>{
 const{command,confirmed}=panel();fireEvent.change(screen.getByRole('textbox',{name:'脚本正文'}),{target:{value:'第一镜。\n第二镜。'}});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));
 await waitFor(()=>expect(confirmed).toHaveBeenCalledExactlyOnceWith('saved',undefined));expect(command.mock.calls).toEqual([['confirmScriptStudio',{episodeId:'e',expectedScriptRevisionId:null,text:'第一镜。\n第二镜。',targetDuration:null,reason:''}],['start',{episodeId:'e'}]]);expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','第一镜。\n第二镜。');expect(screen.queryByRole('dialog')).toBeNull();
});
it('edits an existing script immediately and saves with an optional note in a single action',async()=>{
 const{command,confirmed}=panel({scriptRevisionId:'old',script:'原文',stage:'storyboard_approved'});await revise('新口播');fireEvent.change(notes(),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));
 await waitFor(()=>expect(confirmed).toHaveBeenCalledExactlyOnceWith('saved','调整叙事'));expect(command).toHaveBeenCalledWith('confirmScriptStudio',{episodeId:'e',expectedScriptRevisionId:'old',text:'新口播',targetDuration:null,reason:'调整叙事'});expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps revision text and optional note after a failed save without starting production',async()=>{
 const command=vi.fn(async()=>{throw Error('版本已变化，请刷新。');});panel({scriptRevisionId:'old',script:'原文',stage:'storyboard_approved',command});await revise('新口播');fireEvent.change(notes(),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await screen.findByText('版本已变化，请刷新。');expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','新口播');expect(screen.getByRole('textbox',{name:'修订备注（选填）'})).toHaveProperty('value','调整叙事');expect(command).toHaveBeenCalledOnce();
});
it('keeps edits when restoring is cancelled and restores all fields only after confirmation',async()=>{
 const{command}=panel({scriptRevisionId:'old',script:'原文',stage:'storyboard_approved'});await revise('未保存');fireEvent.change(screen.getByRole('textbox',{name:'目标时长'}),{target:{value:'15'}});fireEvent.change(notes(),{target:{value:'草稿原因'}});fireEvent.click(screen.getByRole('button',{name:'还原已确认脚本'}));fireEvent.click(within(screen.getByRole('dialog',{name:'还原已确认脚本'})).getByRole('button',{name:'取消'}));expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','未保存');fireEvent.click(screen.getByRole('button',{name:'还原已确认脚本'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'还原脚本'}));expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','原文');expect(screen.getByRole('textbox',{name:'目标时长'})).toHaveProperty('value','');expect(screen.getByRole('textbox',{name:'修订备注（选填）'})).toHaveProperty('value','');expect(command).not.toHaveBeenCalled();
});
it('continues an unchanged confirmed script without saving, starting or requesting approval again',async()=>{
 const{command,confirmed}=panel({scriptRevisionId:'old',script:'原文',stage:'storyboard_approved'});await editable();fireEvent.click(screen.getByRole('button',{name:'继续制作'}));expect(confirmed).toHaveBeenCalledExactlyOnceWith('old');expect(command).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps completed script evidence copyable with safe semantic Markdown and no editing or import action',async()=>{
 const script='# 标题\n## 正文\n### 镜头提示\n> 引用说明\n\n- **重点**与 `S01`\n<script>alert(1)</script>';
 panel({scriptRevisionId:'old',script,stage:'production_completed',readOnly:true});const document=await screen.findByRole('document',{name:'主脚本预览'});await waitFor(()=>expect(within(document).getByRole('heading',{name:'标题',level:1})).toBeTruthy());const preview=within(document);expect(preview.getByRole('heading',{name:'正文',level:2})).toBeTruthy();expect(preview.getByRole('blockquote').textContent).toBe('引用说明');expect(preview.getByRole('listitem').querySelector('strong')?.textContent).toBe('重点');expect(document.querySelector('script')).toBeNull();expect(screen.queryByRole('textbox',{name:'脚本正文'})).toBeNull();expect(screen.queryByRole('button',{name:'导入文件'})).toBeNull();
});
it('marks missing original text inline, focuses the field and clears its invalid state as the user types',()=>{
 const{command}=panel();const script=screen.getByRole('textbox',{name:'脚本正文'});fireEvent.change(script,{target:{value:' \n '}});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));const alert=screen.getByRole('alert');expect(alert.textContent).toBe('请填写主脚本。');expect(alert.className).toContain('form-error');expect(script.getAttribute('aria-describedby')).toBe(alert.id);expect(script.getAttribute('aria-invalid')).toBe('true');expect(document.activeElement).toBe(script);expect(command).not.toHaveBeenCalled();fireEvent.change(script,{target:{value:'补充正文'}});expect(screen.queryByRole('alert')).toBeNull();expect(script.getAttribute('aria-invalid')).toBeNull();
});
it('accepts a dropped script as an unconfirmed draft and protects the current text from unsupported, empty and oversized files',async()=>{
 const{container,command}=panel({scriptRevisionId:'s',script:'已确认正文',stage:'storyboard_approved'});await editable();const slot=container.querySelector('.script-studio-drop')!;
 for(const file of [{name:'notes.pdf',size:20,text:async()=> 'PDF'},{name:'empty.txt',size:0,text:async()=>''},{name:'large.md',size:2*1024*1024+1,text:async()=> '过大'}]){fireEvent.drop(slot,{dataTransfer:{files:[file]}});await screen.findByRole('alert');expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','已确认正文');}
 fireEvent.drop(slot,{dataTransfer:{files:[{name:'新脚本.md',size:20,text:async()=> '导入后的正文'}]}});await waitFor(()=>expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','导入后的正文'));expect(screen.getByText('新脚本.md')).toBeTruthy();expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('confirmScriptStudio',expect.objectContaining({text:'导入后的正文',reason:''})));
});
it.each([
 ['v2','# 片名\n## 制作设置\n- 模板版本：2\n- 旁白音色：默认\n## 正文\n### 段落 01\n- 口播：你好，世界！\n- 首帧素材：无\n- 视频生成提示词：山间晨光'],
 ['legacy Markdown','# 标题\n\n## 正文\n你好，**世界**！\n> AI 𠮷。\n\n## 制作设置\n- 画幅：9:16'],
 ['plain text','你好，世界！\nAI 𠮷。'],
 ['incomplete settings','# 片名\n## 制作设置\n- 模板版本：2\n- 旁白音色：默认\n## 正文\n### 段落 01\n- 视频生成提示词：山间晨光']
])('preserves %s source in the editor without restoring retired character statistics',async(_kind,script)=>{
 panel({scriptRevisionId:'s',script,stage:'storyboard_approved'});expect(await editable()).toHaveProperty('value',script);expect(screen.queryByRole('group',{name:'脚本字数'})).toBeNull();expect(screen.queryByText(/脚本字符|口播字数|正文文字数|基准字数/)).toBeNull();
});
it('submits the exact UTF-8 and CRLF source without wrapping it in an internal template',async()=>{
 const script='# 标题\r\n\r\n## 正文\r\n你好，𠮷！\r\n',{command,confirmed}=panel({script});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());expect(command).toHaveBeenCalledWith('confirmScriptStudio',expect.objectContaining({text:script}));expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value',script.replaceAll('\r\n','\n'));
});
it('recovers unsent text, duration and note only for the same Owner, episode and server version',async()=>{
 const props={episodeId:'draft-e',scriptRevisionId:'v1',script:'原文',stage:'storyboard_approved',readOnly:false,pending:false,command:vi.fn(),onConfirmed:vi.fn()};retained.set('draft-e:v1',{sourceText:'原文',targetDuration:null});retained.set('draft-e:v2',{sourceText:'服务器新文',targetDuration:null});
 const view=render(<WorkspaceDraftProvider ownerId="owner-a"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);await revise('未提交正文');fireEvent.change(screen.getByRole('textbox',{name:'目标时长'}),{target:{value:'15'}});fireEvent.change(notes(),{target:{value:'调整叙事'}});view.unmount();
 const recovered=render(<WorkspaceDraftProvider ownerId="owner-a"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);expect(await editable()).toHaveProperty('value','未提交正文');expect(screen.getByRole('textbox',{name:'目标时长'})).toHaveProperty('value','15');expect(notes()).toHaveProperty('value','调整叙事');expect(props.command).not.toHaveBeenCalled();recovered.unmount();
 const otherOwner=render(<WorkspaceDraftProvider ownerId="owner-b"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);expect(await editable()).toHaveProperty('value','原文');otherOwner.unmount();
 const otherEpisode=render(<WorkspaceDraftProvider ownerId="owner-a"><WorkspaceScriptPanel {...props} episodeId="other-e"/></WorkspaceDraftProvider>);expect(await editable()).toHaveProperty('value','原文');otherEpisode.unmount();
 render(<WorkspaceDraftProvider ownerId="owner-a"><WorkspaceScriptPanel {...props} scriptRevisionId="v2" script="服务器新文"/></WorkspaceDraftProvider>);expect(await editable()).toHaveProperty('value','服务器新文');
});
it('migrates a legacy draft only after retained source loads, preserving text, note and filename without approving it',async()=>{
 const legacyInitial={text:'内部标准分镜',reason:'',filename:'script.md'},key='loop-control.workspace-draft.v1:'+JSON.stringify(['owner','legacy-e','script','v1']);
 const oldDraft=JSON.stringify({baseline:JSON.stringify(legacyInitial),value:{text:'未提交原稿\n第二段',reason:'旧备注',filename:'原稿.txt'}});localStorage.setItem(key,oldDraft);
 let resolve!:(value:unknown)=>void;request.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const props={episodeId:'legacy-e',scriptRevisionId:'v1',script:legacyInitial.text,stage:'storyboard_approved',readOnly:false,pending:false,command:vi.fn(),onConfirmed:vi.fn()};
 const element=<WorkspaceDraftProvider ownerId="owner"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>,view=render(element);
 expect(localStorage.getItem(key)).toBe(oldDraft);expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('disabled',true);
 await act(async()=>resolve({sourceText:'保留的原始文案',targetDuration:15}));
 expect(await editable()).toHaveProperty('value','未提交原稿\n第二段');expect(screen.getByRole('textbox',{name:'目标时长'})).toHaveProperty('value','15');expect(notes()).toHaveProperty('value','旧备注');expect(screen.getByText('原稿.txt')).toBeTruthy();expect(props.command).not.toHaveBeenCalled();expect(props.onConfirmed).not.toHaveBeenCalled();
 retained.set('legacy-e:v1',{sourceText:'保留的原始文案',targetDuration:15});request.mockImplementation(async()=>retained.get('legacy-e:v1'));view.unmount();render(element);
 expect(await editable()).toHaveProperty('value','未提交原稿\n第二段');expect(notes()).toHaveProperty('value','旧备注');expect(screen.getByRole('textbox',{name:'目标时长'})).toHaveProperty('value','15');
});
it('keeps the in-memory draft during a same-version source refresh even when browser storage is unavailable',async()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});
 let resolve!:(value:unknown)=>void;request.mockResolvedValueOnce({sourceText:'保留原文',targetDuration:15}).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const props={episodeId:'refresh-e',scriptRevisionId:'v1',script:'内部标准分镜',stage:'storyboard_approved',readOnly:false,pending:false,command:vi.fn(),onConfirmed:vi.fn()};
 const view=render(<WorkspaceDraftProvider ownerId="owner"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);await revise('仅在内存中的修改');fireEvent.change(notes(),{target:{value:'未落盘备注'}});
 view.rerender(<WorkspaceDraftProvider ownerId="owner"><WorkspaceScriptPanel {...props} script="同版本刷新后的内部结构"/></WorkspaceDraftProvider>);
 expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','仅在内存中的修改');expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('disabled',true);
 await act(async()=>resolve({sourceText:'保留原文',targetDuration:15}));expect(await editable()).toHaveProperty('value','仅在内存中的修改');expect(screen.getByRole('textbox',{name:'修订备注（选填）'})).toHaveProperty('value','未落盘备注');expect(props.command).not.toHaveBeenCalled();
});
it.each(['owner','episode','version','baseline','missing field'])('does not restore a legacy draft with mismatched %s',async mismatch=>{
 const initial={text:'内部标准分镜',reason:'',filename:'script.md'},value:Record<string,string>={text:'其他草稿',reason:'旧备注',filename:'原稿.txt'};
 if(mismatch==='missing field')delete value.reason;
 localStorage.setItem('loop-control.workspace-draft.v1:'+JSON.stringify([mismatch==='owner'?'other':'owner',mismatch==='episode'?'other':'legacy-e','script',mismatch==='version'?'other':'v1']),JSON.stringify({baseline:JSON.stringify({...initial,...(mismatch==='baseline'?{text:'不同基准'}:{})}),value}));
 retained.set('legacy-e:v1',{sourceText:'保留的原始文案',targetDuration:null});const command=vi.fn();
 render(<WorkspaceDraftProvider ownerId="owner"><WorkspaceScriptPanel episodeId="legacy-e" scriptRevisionId="v1" script={initial.text} stage="storyboard_approved" readOnly={false} pending={false} command={command} onConfirmed={vi.fn()}/></WorkspaceDraftProvider>);
 expect(await editable()).toHaveProperty('value','保留的原始文案');expect(screen.queryByText('已恢复草稿，尚未确认。')).toBeNull();expect(command).not.toHaveBeenCalled();
});
it('does not resurrect a draft after all fields are manually returned to the saved baseline',async()=>{
 const props={episodeId:'revert-e',scriptRevisionId:'v1',script:'原文',stage:'storyboard_approved',readOnly:false,pending:false,command:vi.fn(),onConfirmed:vi.fn()};retained.set('revert-e:v1',{sourceText:'原文',targetDuration:null});const element=<WorkspaceDraftProvider ownerId="owner"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>;const view=render(element);await revise('临时修改');await revise('原文');view.unmount();render(element);expect(await editable()).toHaveProperty('value','原文');expect(screen.queryByText('已恢复草稿，尚未确认。')).toBeNull();
});
it('keeps a saved revision and draft through parent refresh, then resumes only start after an authoritative read',async()=>{
 const{useState}=await import('react');let starts=0;const commands:string[]=[],confirmed=vi.fn();retained.set('e:old',{sourceText:'原文',targetDuration:null});request.mockImplementation(async(path:string)=>path.startsWith('script-studio?')?retained.get('e:'+new URLSearchParams(path.split('?')[1]).get('scriptRevisionId')):episodeRead());
 function Host(){const[id,setId]=useState('old'),[script,setScript]=useState('原文');return <WorkspaceDraftProvider ownerId="owner"><WorkspaceScriptPanel episodeId="e" scriptRevisionId={id} script={script} stage={id==='old'?'storyboard_approved':'waiting_input'} readOnly={false} pending={false} onConfirmed={confirmed} command={async name=>{commands.push(name);if(name==='confirmScriptStudio'){retained.set('e:saved',{sourceText:'新口播',targetDuration:null});setId('saved');setScript('内部制作结构');return{id:'saved'};}if(++starts===1)throw Error('启动连接中断');return{id:'e'};}}/></WorkspaceDraftProvider>;}
 render(<Host/>);await revise('新口播');fireEvent.change(notes(),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await screen.findByText('脚本已保存，制作尚未确认启动。');expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','新口播');expect(screen.getByRole('textbox',{name:'修订备注（选填）'})).toHaveProperty('value','调整叙事');expect(confirmed).not.toHaveBeenCalled();await editable();fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledWith('saved','调整叙事'));expect(commands).toEqual(['confirmScriptStudio','start','start']);expect(request).toHaveBeenCalledWith('episodes/e');
});
it('reconciles an already-started script without replaying save or start',async()=>{
 const command=vi.fn(async(name:string)=>{if(name==='confirmScriptStudio')return{id:'saved'};throw Error('响应丢失');});const{confirmed}=startFailure(command);await screen.findByRole('button',{name:'继续启动'});request.mockResolvedValue(episodeRead('script_approved'));fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledExactlyOnceWith('saved',undefined));expect(command.mock.calls.map(([name])=>name)).toEqual(['confirmScriptStudio','start']);expect(screen.getByText('制作已启动')).toBeTruthy();
});
it.each([
 ['different revision',{id:'e',main_script_revision_id:'other',stage:'waiting_input',archived_at:null}],
 ['archive',{id:'e',main_script_revision_id:'saved',stage:'waiting_input',archived_at:'today'}],
 ['completed',{id:'e',main_script_revision_id:'saved',stage:'production_completed',archived_at:null}],
 ['missing episode',null]
])('does not resume after %s is read and retains the draft',async(_case,episode)=>{
 const command=vi.fn(async(name:string)=>{if(name==='confirmScriptStudio')return{id:'saved'};throw Error('启动未完成');});const{confirmed}=startFailure(command);await screen.findByRole('button',{name:'继续启动'});request.mockResolvedValue({sections:{episode}});fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await screen.findByText(/当前脚本版本或生产单状态已变化/);expect(confirmed).not.toHaveBeenCalled();expect(command).toHaveBeenCalledTimes(2);expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','恢复正文');
});
it('separates save from start and blocks rapid duplicate confirmation',async()=>{
 let save!:(value:unknown)=>void,start!:(value:unknown)=>void;const confirmed=vi.fn(),command=vi.fn((name:string)=>new Promise(resolve=>{if(name==='confirmScriptStudio')save=resolve;else start=resolve;}));startFailure(command,confirmed);fireEvent.click(screen.getByRole('button',{name:'正在保存…'}));expect(command).toHaveBeenCalledOnce();expect(screen.getByText('正在保存脚本…')).toBeTruthy();await act(async()=>save({id:'saved'}));expect(screen.getByText('脚本已保存，正在启动制作…')).toBeTruthy();expect(confirmed).not.toHaveBeenCalled();expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('disabled',true);await act(async()=>start({id:'e'}));expect(confirmed).toHaveBeenCalledOnce();
});
it('ignores late save after switching episodes and never starts the old episode',async()=>{
 let resolve!:(value:unknown)=>void;const command=vi.fn(()=>new Promise(value=>{resolve=value;})),{rerender,props,confirmed}=startFailure(command);rerender(<WorkspaceScriptPanel {...props} episodeId="other"/>);fireEvent.change(screen.getByRole('textbox',{name:'脚本正文'}),{target:{value:'另一生产单正文'}});await act(async()=>resolve({id:'saved'}));expect(confirmed).not.toHaveBeenCalled();expect(command).toHaveBeenCalledOnce();expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','另一生产单正文');
});
it('does not start after the view becomes read-only during recovery',async()=>{
 const command=vi.fn(async(name:string)=>{if(name==='confirmScriptStudio')return{id:'saved'};throw Error('响应丢失');});const{rerender,props,confirmed}=startFailure(command);await screen.findByRole('button',{name:'继续启动'});let read!:(value:unknown)=>void;request.mockImplementation(()=>new Promise(resolve=>{read=resolve;}));fireEvent.click(screen.getByRole('button',{name:'继续启动'}));rerender(<WorkspaceScriptPanel {...props} readOnly/>);await act(async()=>read(episodeRead()));expect(command).toHaveBeenCalledTimes(2);expect(confirmed).not.toHaveBeenCalled();
});
it('does not start after a successful save returns to a now read-only view',async()=>{
 let resolve!:(value:unknown)=>void;const command=vi.fn(()=>new Promise(value=>{resolve=value;})),{rerender,props,confirmed}=startFailure(command);rerender(<WorkspaceScriptPanel {...props} readOnly/>);await act(async()=>resolve({id:'saved'}));expect(command).toHaveBeenCalledOnce();expect(confirmed).not.toHaveBeenCalled();
});
it('retains draft after a failed recovery read and permits another read without saving again',async()=>{
 const command=vi.fn(async(name:string)=>{if(name==='confirmScriptStudio')return{id:'saved'};throw Error('启动未完成');});const{confirmed}=startFailure(command);await screen.findByRole('button',{name:'继续启动'});request.mockRejectedValueOnce(Error('核对连接中断')).mockResolvedValueOnce(episodeRead('script_approved'));fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await screen.findByText('核对连接中断');expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','恢复正文');expect(confirmed).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());expect(request).toHaveBeenCalledTimes(2);expect(command).toHaveBeenCalledTimes(2);
});
it('can revise a saved script after start failure without a required note or an extra approval',async()=>{
 let revisions=0;const command=vi.fn(async(name:string,data:unknown)=>{if(name==='confirmScriptStudio'){if((data as {expectedScriptRevisionId:string|null}).expectedScriptRevisionId===null)return{id:'saved'};if(++revisions===1)throw Error('保存连接中断');return{id:'newer'};}throw Error('启动中断');});startFailure(command);await screen.findByRole('button',{name:'继续启动'});fireEvent.change(screen.getByRole('textbox',{name:'脚本正文'}),{target:{value:'继续修改的正文'}});expect(screen.queryByRole('button',{name:'继续启动'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await screen.findByText('保存连接中断');fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await screen.findByRole('button',{name:'继续启动'});expect(command.mock.calls.filter(([name,data])=>name==='confirmScriptStudio'&&(data as {expectedScriptRevisionId:string|null}).expectedScriptRevisionId!==null)).toEqual([['confirmScriptStudio',{episodeId:'e',expectedScriptRevisionId:'saved',text:'继续修改的正文',targetDuration:null,reason:''}],['confirmScriptStudio',expect.objectContaining({expectedScriptRevisionId:'saved'})]]);expect(screen.queryByRole('dialog')).toBeNull();
});
it('continues a saved waiting-input script after remount by starting only',async()=>{
 const{command,confirmed}=panel({episodeId:'saved-e',scriptRevisionId:'saved',script:'已保存正文',stage:'waiting_input'});await editable();fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledExactlyOnceWith('saved',undefined));expect(command).toHaveBeenCalledExactlyOnceWith('start',{episodeId:'saved-e'});
});
it('does not accept an old idempotent start receipt for a newer revision through the real localCommand boundary',async()=>{
 const{webcrypto}=await import('node:crypto');vi.stubGlobal('crypto',webcrypto);const{localCommand}=await import('./client');const keys:string[]=[],readbackKeys:string[]=[],confirmed=vi.fn();let starts=0;request.mockResolvedValue({sections:{episode:{id:'receipt-e',main_script_revision_id:'newer',stage:'waiting_input',archived_at:null}}});
 vi.spyOn(globalThis,'fetch').mockImplementation(async(path,init)=>{if(String(path).endsWith('/session'))return Response.json({csrfToken:'test-csrf'});const body=JSON.parse(String(init?.body));if(String(path).endsWith('/command-receipt')){readbackKeys.push(body.operation.idempotencyKey);return Response.json(readbackKeys.length===1?{status:'unknown'}:{status:'committed',result:{id:'receipt-e',main_script_revision_id:'saved',stage:'script_approved'}});}if(body.command==='confirmScriptStudio')return Response.json({id:body.data.expectedScriptRevisionId?'newer':'saved'});keys.push(body.idempotencyKey);if(++starts===1)return Response.json({error:'启动结果丢失'},{status:503});return Response.json({id:'receipt-e',main_script_revision_id:'newer',stage:'script_approved'});});
 panel({episodeId:'receipt-e',command:(name,data)=>localCommand(name,data,undefined,'episode-commands'),onConfirmed:confirmed});await revise('首次正文');fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await screen.findByRole('button',{name:'继续启动'});await revise('再次修改');fireEvent.change(notes(),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'继续制作'}));await screen.findByRole('button',{name:'继续启动'});expect(confirmed).not.toHaveBeenCalled();expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','再次修改');expect(readbackKeys).toEqual([keys[0],keys[0]]);fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledExactlyOnceWith('newer','调整叙事'));expect(keys).toHaveLength(2);expect(keys[1]).not.toBe(keys[0]);
});
it('shows recovery read errors locally even when the parent presents the original failure',async()=>{
 const command=vi.fn(async(name:string)=>{if(name==='confirmScriptStudio')return{id:'saved'};throw Error('启动未完成');});const{rerender,props}=startFailure(command);await screen.findByRole('button',{name:'继续启动'});rerender(<WorkspaceScriptPanel {...props} errorPresented/>);request.mockRejectedValue(Error('重新核对连接中断'));fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await screen.findByText('重新核对连接中断');
});
it('ignores retained-source metadata that arrives after switching to another episode and editing its draft',async()=>{
 let old!:(value:unknown)=>void;request.mockImplementation((path:string)=>path.includes('episodeId=old-e')?new Promise(resolve=>{old=resolve;}):Promise.resolve({sourceText:'新单原文',targetDuration:15}));const props={episodeId:'old-e',scriptRevisionId:'v1',script:'旧内部格式',stage:'storyboard_approved',readOnly:false,pending:false,command:vi.fn(),onConfirmed:vi.fn()},view=render(<WorkspaceScriptPanel {...props}/>);expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('disabled',true);view.rerender(<WorkspaceScriptPanel {...props} episodeId="new-e" scriptRevisionId="v2" script="新内部格式"/>);await revise('新单未保存草稿');await act(async()=>old({sourceText:'迟到旧单原文',targetDuration:30}));expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','新单未保存草稿');expect(screen.getByRole('textbox',{name:'目标时长'})).toHaveProperty('value','15');expect(props.command).not.toHaveBeenCalled();
});
it('does not overwrite a newer manual edit when an imported file finishes reading late',async()=>{
 const{container,command}=panel({script:'原文'});let finish!:(value:string)=>void;fireEvent.drop(container.querySelector('.script-studio-drop')!,{dataTransfer:{files:[{name:'slow.md',size:20,text:()=>new Promise<string>(resolve=>{finish=resolve;})}]}});await revise('文件读取期间的新草稿');await act(async()=>finish('迟到的文件正文'));expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('value','文件读取期间的新草稿');expect(screen.queryByText('slow.md')).toBeNull();expect(command).not.toHaveBeenCalled();
});
