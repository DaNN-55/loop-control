import {render,screen,fireEvent,cleanup,waitFor,within,act} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
import {WorkspaceDraftProvider} from './WorkspaceDraft';
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();});
it('confirms a new script through material registration and start, then locks a copyable preview',async()=>{
 const command=vi.fn(async()=>({id:'new-script'})),confirmed=vi.fn();render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId={null} script="" stage="waiting_input" readOnly={false} pending={false} command={command} onConfirmed={confirmed}/>);
 expect(screen.getByRole('button',{name:'确认脚本'}).closest('aside')).toBeTruthy();fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'第一镜。\n第二镜。'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));
 await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());expect(command.mock.calls).toEqual([['importMaterial',expect.objectContaining({episodeId:'e',materialType:'script',isMainScript:true,sourcePath:'script.md'})],['start',{episodeId:'e'}]]);expect(within(screen.getByRole('document',{name:'主脚本预览'})).getAllByText(/第[一二]镜。/).map(p=>p.textContent)).toEqual(['第一镜。','第二镜。']);expect(screen.queryByRole('textbox',{name:'主脚本'})).toBeNull();expect(screen.getByRole('button',{name:'修改脚本'})).toBeTruthy();
});
it('opens confirmed scripts as preview and requires a second confirmation before saving a revision',async()=>{
 const command=vi.fn(async()=>({id:'revised'})),confirmed=vi.fn();render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="old" script="原文" stage="storyboard_approved" readOnly={false} pending={false} command={command} onConfirmed={confirmed}/>);
 expect(screen.queryByRole('textbox',{name:'主脚本'})).toBeNull();expect(screen.getByRole('button',{name:'修改脚本'}).closest('aside')).toBeTruthy();expect(screen.queryByRole('button',{name:'上传脚本'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'新口播'}});fireEvent.change(screen.getByRole('textbox',{name:'脚本修订原因'}),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));
 expect(screen.getByRole('button',{name:'确认脚本修订'}).closest('aside')).toBeTruthy();expect(screen.getByRole('button',{name:'取消编辑'}).closest('aside')).toBeTruthy();expect(screen.getByRole('textbox',{name:'脚本修订原因'}).closest('aside')).toBeTruthy();const dialog=screen.getByRole('dialog',{name:'确认脚本修订'});expect(command).not.toHaveBeenCalled();expect(dialog.textContent).toContain('调整叙事');fireEvent.click(within(dialog).getByRole('button',{name:'取消'}));expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe('新口播');fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));fireEvent.click(screen.getByRole('button',{name:'确认保存修订'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());expect(command).toHaveBeenCalledWith('reconfirmScript',{episodeId:'e',expectedScriptRevisionId:'old',text:'# 主脚本\n\n## 正文\n\n新口播\n',reason:'调整叙事'});expect(screen.getByRole('document',{name:'主脚本预览'}).textContent).toContain('新口播');
});
it('keeps revision text and reason after a failed confirmed save',async()=>{
 const command=vi.fn(async()=>{throw Error('版本已变化，请刷新。');});render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="old" script="原文" stage="storyboard_approved" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'新口播'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));await screen.findByText('请填写修订原因。');expect(command).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('textbox',{name:'脚本修订原因'}),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));fireEvent.click(screen.getByRole('button',{name:'确认保存修订'}));await screen.findByText('版本已变化，请刷新。');expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe('新口播');expect((screen.getByRole('textbox',{name:'脚本修订原因'}) as HTMLInputElement).value).toBe('调整叙事');expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps edits when discard is cancelled and returns to the saved preview only after confirmation',()=>{
 const command=vi.fn();render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="old" script="原文" stage="storyboard_approved" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'未保存'}});fireEvent.change(screen.getByRole('textbox',{name:'脚本修订原因'}),{target:{value:'草稿原因'}});fireEvent.click(screen.getByRole('button',{name:'取消编辑'}));fireEvent.click(within(screen.getByRole('dialog',{name:'放弃脚本修改'})).getByRole('button',{name:'取消'}));expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe('未保存');fireEvent.click(screen.getByRole('button',{name:'取消编辑'}));fireEvent.click(screen.getByRole('button',{name:'放弃修改'}));expect(screen.getByRole('document',{name:'主脚本预览'}).textContent).toBe('原文');expect(command).not.toHaveBeenCalled();
});
it('leaves unchanged editing without a discard dialog',()=>{
 render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="old" script="原文" stage="storyboard_approved" readOnly={false} pending={false} command={vi.fn()} onConfirmed={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.click(screen.getByRole('button',{name:'取消编辑'}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('document',{name:'主脚本预览'})).toBeTruthy();
});
it('keeps completed script evidence copyable with no edit or upload action',()=>{
 render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="old" script={'历史原文\n第二段'} stage="production_completed" readOnly pending={false} command={vi.fn()} onConfirmed={()=>{}}/>);expect(screen.getByRole('document',{name:'主脚本预览'}).querySelectorAll('p')).toHaveLength(2);expect(screen.queryByRole('button',{name:'修改脚本'})).toBeNull();expect(screen.queryByRole('button',{name:'上传脚本'})).toBeNull();
});

it('marks missing required fields inline, focuses them and clears the invalid state as the user types',()=>{
 const command=vi.fn();render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="old" script="原文" stage="storyboard_approved" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'新文'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));const reason=screen.getByLabelText('脚本修订原因');expect(reason.getAttribute('aria-invalid')).toBe('true');expect(document.activeElement).toBe(reason);expect(reason.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);expect(screen.getByRole('alert').className).toContain('form-error');expect(screen.getByRole('alert').closest('label')).toBe(reason.closest('label'));
 fireEvent.change(reason,{target:{value:'调整'}});expect(reason.getAttribute('aria-invalid')).toBeNull();expect(screen.queryByRole('alert')).toBeNull();expect(command).not.toHaveBeenCalled();
});
it('accepts a dropped script as an unconfirmed draft and rejects unsupported files',async()=>{
 const command=vi.fn();const{container}=render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="s" script="已确认正文" stage="storyboard_approved" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));const slot=container.querySelector('.workspace-script-file')!;
 fireEvent.drop(slot,{dataTransfer:{files:[{name:'notes.pdf',size:20,text:async()=> 'PDF'}]}});await screen.findByText('请选择 Markdown 或 TXT 脚本。');expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe('已确认正文');
 fireEvent.drop(slot,{dataTransfer:{files:[{name:'新脚本.md',size:20,text:async()=> '导入后的正文'}]}});await waitFor(()=>expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe('导入后的正文'));expect(screen.getByText('新脚本.md')).toBeTruthy();expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));expect(screen.getByRole('textbox',{name:'脚本修订原因'}).getAttribute('aria-invalid')).toBe('true');
});

it('renders confirmed Markdown semantically and keeps the exact source when editing',()=>{
 const script='# 标题\n## 正文\n### 镜头提示\n> 引用说明\n\n- **重点**与 `S01`\n<script>alert(1)</script>';
 const command=vi.fn();render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="s" script={script} stage="storyboard_approved" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);
 const preview=within(screen.getByRole('document',{name:'主脚本预览'}));expect(preview.getByRole('heading',{name:'标题',level:1})).toBeTruthy();expect(preview.getByRole('heading',{name:'正文',level:2})).toBeTruthy();expect(preview.getByRole('blockquote').textContent).toBe('引用说明');expect(preview.getByRole('listitem').querySelector('strong')?.textContent).toBe('重点');expect(screen.getByRole('document').querySelector('script')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe(script);expect(command).not.toHaveBeenCalled();
});

it('shows a visible script error beside an empty field before submitting any command',()=>{
 const command=vi.fn();render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId={null} script="" stage="waiting_input" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);
 const script=screen.getByRole('textbox',{name:'主脚本'});fireEvent.change(script,{target:{value:' \n '}});fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));
 const alert=screen.getByRole('alert');expect(alert.textContent).toBe('请填写主脚本。');expect(alert.className).toContain('form-error');expect(alert.closest('label')).toBe(script.closest('label'));expect(script.getAttribute('aria-describedby')).toBe(alert.id);expect(script.getAttribute('aria-invalid')).toBe('true');expect(document.activeElement).toBe(script);expect(command).not.toHaveBeenCalled();
 fireEvent.change(script,{target:{value:'补充正文'}});expect(screen.queryByRole('alert')).toBeNull();expect(script.getAttribute('aria-invalid')).toBeNull();
});

it('separates complete characters from spoken letters and numbers for v2',()=>{
 const script="# 片名\n## 制作设置\n- 模板版本：2\n- 旁白音色：默认\n## 正文\n### 段落 01\n- 口播：你好，世界！\n- 首帧素材：无\n- 视频生成提示词：山间晨光\n### 段落 02\n- 口播：今天 AI 见！\n- 首帧素材：无\n- 视频生成提示词：城市黄昏";render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="s" script={script} stage="storyboard_approved" readOnly={false} pending={false} command={vi.fn()} onConfirmed={()=>{}}/>);
 const counts=within(screen.getByRole('group',{name:'脚本字数'}));expect(counts.getByText('脚本字符 131')).toBeTruthy();expect(counts.getByText('口播字数 9')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe(script);
});

it('separates complete characters from spoken letters and numbers for legacy Markdown',()=>{
 const script="# 标题\n\n## 正文\n你好，**世界**！\n> AI 𠮷。\n\n## 制作设置\n- 画幅：9:16";render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="s" script={script} stage="storyboard_approved" readOnly={false} pending={false} command={vi.fn()} onConfirmed={()=>{}}/>);
 const counts=within(screen.getByRole('group',{name:'脚本字数'}));expect(counts.getByText('脚本字符 49')).toBeTruthy();expect(counts.getByText('正文文字数 7')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe(script);
});

it('separates complete characters from spoken letters and numbers for plain text',()=>{
 const script="你好，世界！\nAI 𠮷。";render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="s" script={script} stage="storyboard_approved" readOnly={false} pending={false} command={vi.fn()} onConfirmed={()=>{}}/>);
 const counts=within(screen.getByRole('group',{name:'脚本字数'}));expect(counts.getByText('脚本字符 12')).toBeTruthy();expect(counts.getByText('正文文字数 7')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe(script);
});

it('does not report v2 settings as spoken text while the draft is invalid',()=>{
 const script='# 片名\n## 制作设置\n- 模板版本：2\n- 旁白音色：默认\n## 正文\n### 段落 01\n- 视频生成提示词：山间晨光';
 render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId={null} script={script} stage="waiting_input" readOnly={false} pending={false} command={vi.fn()} onConfirmed={()=>{}}/>);
 expect(within(screen.getByRole('group',{name:'脚本字数'})).getByText('口播字数 暂无法统计')).toBeTruthy();
});
it('updates draft counts while preserving the exact UTF-8 source submitted for confirmation',async()=>{
 const script='# 标题\r\n\r\n## 正文\r\n你好，𠮷！\r\n',command=vi.fn(async(_name:string,_data:unknown)=>({id:'new-script'}));
 render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId={null} script={script} stage="waiting_input" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);
 expect(within(screen.getByRole('group',{name:'脚本字数'})).getByText('正文文字数 3')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));
 await screen.findByRole('document',{name:'主脚本预览'});const imported=command.mock.calls.find(([name])=>name==='importMaterial')!;
 expect(Buffer.from((imported[1] as {contentBase64:string}).contentBase64,'base64').toString('utf8')).toBe(script);
 fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'# 标题\n## 正文\n一二三四。'}});
 expect(within(screen.getByRole('group',{name:'脚本字数'})).getByText('正文文字数 4')).toBeTruthy();expect(screen.getByText('有未确认修改')).toBeTruthy();
});

it('recovers unsent script text and reason only for the same Owner, episode and server version',()=>{
 const command=vi.fn(),props={episodeId:'draft-e',scriptRevisionId:'v1',script:'原文',stage:'storyboard_approved',readOnly:false,pending:false,command,onConfirmed:()=>{}};
 const view=render(<WorkspaceDraftProvider ownerId="owner-a"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);
 fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'未提交正文'}});fireEvent.change(screen.getByLabelText('脚本修订原因'),{target:{value:'调整叙事'}});view.unmount();
 const recovered=render(<WorkspaceDraftProvider ownerId="owner-a"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);
 expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('未提交正文');expect((screen.getByLabelText('脚本修订原因') as HTMLInputElement).value).toBe('调整叙事');expect(command).not.toHaveBeenCalled();recovered.unmount();
 const other=render(<WorkspaceDraftProvider ownerId="owner-b"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>);expect(screen.getByRole('document').textContent).toBe('原文');other.unmount();
 render(<WorkspaceDraftProvider ownerId="owner-a"><WorkspaceScriptPanel {...props} scriptRevisionId="v2" script="服务器新文"/></WorkspaceDraftProvider>);expect(screen.getByRole('document').textContent).toBe('服务器新文');
});
it('does not resurrect a draft after the user manually returns all fields to the saved baseline',()=>{
 const props={episodeId:'revert-e',scriptRevisionId:'revert-v1',script:'原文',stage:'storyboard_approved',readOnly:false,pending:false,command:vi.fn(),onConfirmed:()=>{}},panel=<WorkspaceDraftProvider ownerId="revert-owner"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>;
 const view=render(panel);fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'临时修改'}});fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'原文'}});view.unmount();render(panel);expect(screen.queryByLabelText('主脚本')).toBeNull();expect(screen.getByRole('document').textContent).toBe('原文');
});

it('keeps the saved revision and draft through parent refresh, then resumes only start after an authoritative read',async()=>{
 const {useState}=await import('react');let starts=0;const commands:string[]=[],confirmed=vi.fn();
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({sections:{episode:{id:'e',main_script_revision_id:'saved',stage:'waiting_input',archived_at:null},historicalReadOnly:false}}),{status:200}));
 function Host(){const [id,setId]=useState('old'),[script,setScript]=useState('原文');
  return <WorkspaceDraftProvider ownerId="owner"><WorkspaceScriptPanel episodeId="e" scriptRevisionId={id} script={script} stage={id==='old'?'storyboard_approved':'waiting_input'} readOnly={false} pending={false} onConfirmed={confirmed} command={async name=>{commands.push(name);if(name==='reconfirmScript'){setId('saved');setScript('# 主脚本\n\n## 正文\n\n新口播\n');return{id:'saved'};}if(++starts===1)throw Error('启动连接中断');return{id:'e'};}}/></WorkspaceDraftProvider>;
 }
 render(<Host/>);fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'新口播'}});fireEvent.change(screen.getByLabelText('脚本修订原因'),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));fireEvent.click(screen.getByRole('button',{name:'确认保存修订'}));
 await screen.findByText('脚本已保存，制作尚未确认启动。');expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('新口播');expect((screen.getByLabelText('脚本修订原因') as HTMLInputElement).value).toBe('调整叙事');expect(confirmed).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledWith('saved','调整叙事'));expect(commands).toEqual(['reconfirmScript','start','start']);expect(screen.getByRole('document',{name:'主脚本预览'}).textContent).toContain('新口播');
 vi.restoreAllMocks();
});

function startFailure(command:(name:string,data:unknown)=>Promise<unknown>,confirmed=vi.fn()){
 const props={episodeId:'e',scriptRevisionId:null,script:'',stage:'waiting_input',readOnly:false,pending:false,command,onConfirmed:confirmed};
 const view=render(<WorkspaceScriptPanel {...props}/>);fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'恢复正文'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));return{...view,props,confirmed};
}
it('reconciles an already-started saved script without replaying start or clearing another visit',async()=>{
 const command=vi.fn(async(name:string)=>{if(name==='importMaterial')return{id:'saved'};throw Error('响应丢失');});const{confirmed}=startFailure(command);
 await screen.findByRole('button',{name:'继续启动'});vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({sections:{episode:{id:'e',main_script_revision_id:'saved',stage:'script_approved',archived_at:null}}}));
 fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledExactlyOnceWith('saved',undefined));expect(command.mock.calls.map(([name])=>name)).toEqual(['importMaterial','start']);expect(screen.getByText('制作已启动')).toBeTruthy();
});
it.each([
 ['different revision',{id:'e',main_script_revision_id:'other',stage:'waiting_input',archived_at:null}],
 ['archive',{id:'e',main_script_revision_id:'saved',stage:'waiting_input',archived_at:'today'}],
 ['completed',{id:'e',main_script_revision_id:'saved',stage:'production_completed',archived_at:null}],
 ['missing episode',null]
])('does not resume a saved script after %s is read',async(_case,episode)=>{
 const command=vi.fn(async(name:string)=>{if(name==='importMaterial')return{id:'saved'};throw Error('启动未完成');});const{confirmed}=startFailure(command);
 await screen.findByRole('button',{name:'继续启动'});vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({sections:{episode}}));fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await screen.findByText(/当前脚本版本或生产单状态已变化/);expect(confirmed).not.toHaveBeenCalled();expect(command).toHaveBeenCalledTimes(2);expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('恢复正文');
});
it('keeps saving and starting separate and blocks rapid duplicate confirmation',async()=>{
 let save!:(value:unknown)=>void,start!:(value:unknown)=>void;const confirmed=vi.fn(),command=vi.fn((name:string)=>new Promise(resolve=>{if(name==='importMaterial')save=resolve;else start=resolve;}));startFailure(command,confirmed);
 fireEvent.click(screen.getByRole('button',{name:'正在保存…'}));expect(command).toHaveBeenCalledTimes(1);expect(screen.getByText('正在保存脚本…')).toBeTruthy();
 await act(async()=>save({id:'saved'}));expect(screen.getByText('脚本已保存，正在启动制作…')).toBeTruthy();expect(confirmed).not.toHaveBeenCalled();expect(screen.getByLabelText('主脚本')).toHaveProperty('disabled',true);
 await act(async()=>start({id:'e'}));expect(confirmed).toHaveBeenCalledOnce();
});
it('ignores a late save after switching episodes and does not start the old episode',async()=>{
 let resolve!:(value:unknown)=>void;const command=vi.fn(()=>new Promise(value=>{resolve=value;})),{rerender,props,confirmed}=startFailure(command);
 rerender(<WorkspaceScriptPanel {...props} episodeId="other"/>);fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'另一生产单正文'}});await act(async()=>resolve({id:'saved'}));expect(confirmed).not.toHaveBeenCalled();expect(command).toHaveBeenCalledTimes(1);expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('另一生产单正文');
});
it('does not start after the view becomes read-only during recovery',async()=>{
 const command=vi.fn(async(name:string)=>{if(name==='importMaterial')return{id:'saved'};throw Error('响应丢失');});const{rerender,props,confirmed}=startFailure(command);await screen.findByRole('button',{name:'继续启动'});
 let read!:(value:Response)=>void;vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(resolve=>{read=resolve;}));fireEvent.click(screen.getByRole('button',{name:'继续启动'}));rerender(<WorkspaceScriptPanel {...props} readOnly/>);
 await act(async()=>read(Response.json({sections:{episode:{id:'e',main_script_revision_id:'saved',stage:'waiting_input',archived_at:null}}})));expect(command).toHaveBeenCalledTimes(2);expect(confirmed).not.toHaveBeenCalled();
});
it('retains a draft after a failed recovery read and permits another read without saving again',async()=>{
 const command=vi.fn(async(name:string)=>{if(name==='importMaterial')return{id:'saved'};throw Error('启动未完成');});const{confirmed}=startFailure(command);await screen.findByRole('button',{name:'继续启动'});
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(Error('核对连接中断')).mockResolvedValueOnce(Response.json({sections:{episode:{id:'e',main_script_revision_id:'saved',stage:'script_approved',archived_at:null}}}));
 fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await screen.findByText('核对连接中断');expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('恢复正文');expect(confirmed).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());expect(fetcher).toHaveBeenCalledTimes(2);expect(command).toHaveBeenCalledTimes(2);
});
it('requires a reason and a new confirmation when editing an already-saved script after start failure',async()=>{
 let revisions=0;const command=vi.fn(async(name:string)=>{if(name==='importMaterial')return{id:'saved'};if(name==='reconfirmScript'){if(++revisions===1)throw Error('保存连接中断');return{id:'newer'};}throw Error('启动中断');});startFailure(command);await screen.findByRole('button',{name:'继续启动'});
 fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'继续修改的正文'}});expect(screen.queryByRole('button',{name:'继续启动'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));await screen.findByText('请填写修订原因。');fireEvent.change(screen.getByLabelText('脚本修订原因'),{target:{value:'修改叙事'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));fireEvent.click(screen.getByRole('button',{name:'确认保存修订'}));await screen.findByText('保存连接中断');
 fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));fireEvent.click(screen.getByRole('button',{name:'确认保存修订'}));await screen.findByRole('button',{name:'继续启动'});expect(command.mock.calls.filter(([name])=>name==='reconfirmScript')).toEqual([['reconfirmScript',{episodeId:'e',expectedScriptRevisionId:'saved',text:'# 主脚本\n\n## 正文\n\n继续修改的正文\n',reason:'修改叙事'}],['reconfirmScript',expect.objectContaining({expectedScriptRevisionId:'saved'})]]);
});
it('continues a saved waiting-input script after remount without importing or revising it',async()=>{
 const command=vi.fn(async()=>({id:'e'})),confirmed=vi.fn();render(<WorkspaceScriptPanel episodeId="saved-e" scriptRevisionId="saved" script={'# 主脚本\n\n## 正文\n\n已保存正文\n'} stage="waiting_input" readOnly={false} pending={false} command={command} onConfirmed={confirmed}/>);fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledExactlyOnceWith('saved',undefined));expect(command).toHaveBeenCalledExactlyOnceWith('start',{episodeId:'saved-e'});
});
it('does not treat an old idempotent start receipt as successful startup of a newer revision',async()=>{
 const {webcrypto}=await import('node:crypto');vi.stubGlobal('crypto',webcrypto);const{localCommand}=await import('./client');const keys:string[]=[],confirmed=vi.fn();let starts=0;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(path,init)=>{
  if(String(path).endsWith('/session'))return Response.json({csrfToken:'test-csrf'});
  if(String(path).includes('/episodes/receipt-e'))return Response.json({sections:{episode:{id:'receipt-e',main_script_revision_id:'newer',stage:'waiting_input',archived_at:null}}});
  const body=JSON.parse(String(init?.body));
  if(body.command==='importMaterial')return Response.json({id:'saved'});
  if(body.command==='reconfirmScript')return Response.json({id:'newer'});
  keys.push(body.idempotencyKey);if(++starts===1)return Response.json({error:'启动结果丢失'},{status:503});
  return Response.json({id:'receipt-e',main_script_revision_id:starts===2?'saved':'newer',stage:'script_approved'});
 });
 render(<WorkspaceScriptPanel episodeId="receipt-e" scriptRevisionId={null} script="" stage="waiting_input" readOnly={false} pending={false} command={(name,data)=>localCommand(name,data,undefined,'episode-commands')} onConfirmed={confirmed}/>);
 fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'首次正文'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));await screen.findByRole('button',{name:'继续启动'});
 fireEvent.change(screen.getByLabelText('主脚本'),{target:{value:'再次修改'}});fireEvent.change(screen.getByLabelText('脚本修订原因'),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));fireEvent.click(screen.getByRole('button',{name:'确认保存修订'}));
 await screen.findByRole('button',{name:'继续启动'});expect(confirmed).not.toHaveBeenCalled();expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('再次修改');expect(keys[0]).toBe(keys[1]);
 fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledExactlyOnceWith('newer','调整叙事'));expect(keys[2]).not.toBe(keys[1]);
 vi.unstubAllGlobals();sessionStorage.clear();
});
it('shows recovery-read errors locally even when the parent presents the original start failure',async()=>{
 const command=vi.fn(async(name:string)=>{if(name==='importMaterial')return{id:'saved'};throw Error('启动未完成');});const{rerender,props}=startFailure(command);await screen.findByRole('button',{name:'继续启动'});rerender(<WorkspaceScriptPanel {...props} errorPresented/>);
 vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('重新核对连接中断'));fireEvent.click(screen.getByRole('button',{name:'继续启动'}));await screen.findByText('重新核对连接中断');
});
