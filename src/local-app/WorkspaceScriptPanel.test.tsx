import {render,screen,fireEvent,cleanup,waitFor,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
afterEach(cleanup);
it('confirms a new script through material registration and start, then locks a copyable preview',async()=>{
 const command=vi.fn(async()=>({id:'new-script'})),confirmed=vi.fn();render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId={null} script="" stage="waiting_input" readOnly={false} pending={false} command={command} onConfirmed={confirmed}/>);
 expect(screen.getByRole('button',{name:'确认脚本'}).closest('aside')).toBeTruthy();fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'第一镜。\n第二镜。'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));
 await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());expect(command.mock.calls).toEqual([['importMaterial',expect.objectContaining({episodeId:'e',materialType:'script',isMainScript:true,sourcePath:'script.md'})],['start',{episodeId:'e'}]]);expect(within(screen.getByRole('document',{name:'主脚本预览'})).getAllByText(/第[一二]镜。/).map(p=>p.textContent)).toEqual(['第一镜。','第二镜。']);expect(screen.queryByRole('textbox',{name:'主脚本'})).toBeNull();expect(screen.getByRole('button',{name:'修改脚本'})).toBeTruthy();
});
it('opens confirmed scripts as preview and requires a second confirmation before saving a revision',async()=>{
 const command=vi.fn(async()=>({})),confirmed=vi.fn();render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="old" script="原文" stage="storyboard_approved" readOnly={false} pending={false} command={command} onConfirmed={confirmed}/>);
 expect(screen.queryByRole('textbox',{name:'主脚本'})).toBeNull();expect(screen.getByRole('button',{name:'修改脚本'}).closest('aside')).toBeTruthy();expect(screen.queryByRole('button',{name:'上传脚本'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'修改脚本'}));fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'新口播'}});fireEvent.change(screen.getByRole('textbox',{name:'脚本修订原因'}),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));
 expect(screen.getByRole('button',{name:'确认脚本修订'}).closest('aside')).toBeTruthy();expect(screen.getByRole('button',{name:'取消编辑'}).closest('aside')).toBeTruthy();expect(screen.getByRole('textbox',{name:'脚本修订原因'}).closest('aside')).toBeTruthy();const dialog=screen.getByRole('dialog',{name:'确认脚本修订'});expect(command).not.toHaveBeenCalled();expect(dialog.textContent).toContain('调整叙事');fireEvent.click(within(dialog).getByRole('button',{name:'取消'}));expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe('新口播');fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));fireEvent.click(screen.getByRole('button',{name:'确认保存修订'}));await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());expect(command).toHaveBeenCalledWith('reconfirmScript',{episodeId:'e',expectedScriptRevisionId:'old',text:'新口播',reason:'调整叙事'});expect(screen.getByRole('document',{name:'主脚本预览'}).textContent).toBe('新口播');
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
