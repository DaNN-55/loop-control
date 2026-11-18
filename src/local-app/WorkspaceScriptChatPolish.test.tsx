import {cleanup,render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
const {request,command}=vi.hoisted(()=>({request:vi.fn(),command:vi.fn()}));
vi.mock('./client',()=>({localRequest:request,localCommand:command}));
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
import {WorkspaceDraftProvider} from './WorkspaceDraft';
import {localScriptStudioPlan} from '../scriptStudio';
const source='雪山晨光。',plan=localScriptStudioPlan(source,15),receipt={requestId:'plan',status:'completed',plan};
function setup(revision:string|null=null,candidate=plan){
 request.mockImplementation(async(path:string)=>path==='connections'?{serviceCatalog:{groups:[{capability:'language_model',services:[{id:'m',provider:'openai',adapter:'openai_responses',models:['gpt-5.6-luna'],connectionVersionId:'c',executable:true}]}]}}:path.startsWith('script-studio?')?{sourceText:source,targetDuration:15,plan}:{turns:[{requestId:'plan',mode:'optimize',instruction:'保留原文',answer:'保持缓慢推进。',model:'gpt-6.1-sol',provider:'openai',status:'completed'}],result:{...receipt,plan:candidate},mode:'optimize'});
 return render(<WorkspaceDraftProvider ownerId="polish"><WorkspaceScriptPanel episodeId="polish-e" scriptRevisionId={revision} script={source} stage="waiting_input" readOnly={false} pending={false} command={vi.fn()} onConfirmed={vi.fn()}/></WorkspaceDraftProvider>);
}
afterEach(()=>{cleanup();localStorage.clear();vi.resetAllMocks();});
it('moves context help out of the chat and labels replies with their recorded model',async()=>{
 const{container}=setup();await screen.findByText('保持缓慢推进。');const chat=screen.getByRole('complementary',{name:'拍法助手'});expect(within(chat).queryByText('当前脚本与分镜')).toBeNull();expect(container.querySelector('.script-studio-chat-user strong')).toBeNull();expect(container.querySelector('.script-studio-chat-assistant-heading')?.textContent).toContain('gpt-6.1-sol');fireEvent.click(screen.getByRole('button',{name:'使用帮助'}));expect(screen.getByRole('dialog',{name:'使用帮助'}).textContent).toContain('自动携带当前原文');
});
it('uses a native discrete effort slider with accessible values and no automatic request',async()=>{
 setup();await waitFor(()=>expect(screen.getByRole('button',{name:'推理强度：关闭'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'推理强度：关闭'}));const slider=screen.getByRole('slider',{name:'推理强度'});expect(slider).toHaveProperty('type','range');expect(slider).toHaveProperty('max','5');fireEvent.change(slider,{target:{value:'3'}});expect(slider.getAttribute('aria-valuetext')).toBe('高');expect(command).not.toHaveBeenCalled();
});
it('keeps the mode trigger, selected mode, placeholder and submitted command in sync',async()=>{
 setup();await screen.findByText('保持缓慢推进。');fireEvent.click(screen.getByRole('button',{name:'交流方式：调整拍法'}));fireEvent.click(screen.getByRole('button',{name:'仅讨论'}));fireEvent.click(screen.getByRole('button',{name:'关闭'}));expect(screen.getByRole('button',{name:'交流方式：仅讨论'})).toBeTruthy();expect(screen.getByRole('textbox',{name:'修改要求'}).getAttribute('placeholder')).toContain('讨论');command.mockResolvedValue({requestId:'talk',status:'completed',message:'建议保留近景。'});fireEvent.change(screen.getByRole('textbox',{name:'修改要求'}),{target:{value:'近景合适吗？'}});fireEvent.submit(screen.getByRole('form',{name:'拍法对话'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('optimize',expect.objectContaining({mode:'discuss'}),undefined,'script-studio'));
});
it('opens compact script history from the same icon component as help',async()=>{
 setup('version-123');await waitFor(()=>expect(screen.getByRole('textbox',{name:'脚本正文'})).toHaveProperty('disabled',false));const history=screen.getByRole('button',{name:'历史'});expect(history.tagName).toBe('BUTTON');expect(history.classList.contains('script-studio-icon')).toBe(true);fireEvent.click(history);const popup=screen.getByRole('dialog',{name:'脚本历史'});expect(within(popup).getByRole('textbox',{name:'修订备注（选填）'})).toBeTruthy();expect(popup.textContent).not.toContain('确认后保留原文与拍法，已有工程和媒体继续保留。');
});

it('keeps the complete explanation available behind a concise preview',async()=>{
 const full='这是用于验证的完整拍法说明。'.repeat(15);setup(null,{...plan,summary:full,sourceUse:'逐字保留口播，画面按故事安排。',warnings:['需补充画面来源']});await screen.findByRole('button',{name:'拍法说明'});fireEvent.click(screen.getByRole('button',{name:'拍法说明'}));const popup=screen.getByRole('dialog',{name:'拍法说明'});expect(popup.querySelector('.script-studio-explanation-summary')?.textContent?.length).toBeLessThan(110);expect(within(popup).getByText(full).closest('details')?.open).toBe(false);fireEvent.click(within(popup).getByText('原文安排与完整说明'));expect(within(popup).getByText(full).closest('details')?.open).toBe(true);expect(within(popup).getByText('需补充画面来源')).toBeTruthy();
});
