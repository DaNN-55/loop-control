import {cleanup,render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
const {request,modelCommand,sessionList}=vi.hoisted(()=>({request:vi.fn(),modelCommand:vi.fn(),sessionList:vi.fn()}));
vi.mock('./client',()=>({localRequest:(path:string,init?:RequestInit)=>path==='script-studio'&&JSON.parse(String(init?.body)).command==='conversations'?sessionList():request(path,init),localCommand:modelCommand}));
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
import {WorkspaceDraftProvider} from './WorkspaceDraft';
import {localScriptStudioPlan} from '../scriptStudio';
const source='雪山晨光。',plan=localScriptStudioPlan(source,15);
const catalog={serviceCatalog:{groups:[{capability:'language_model',services:[{id:'m',provider:'openai',adapter:'openai_responses',models:['gpt-5.6-luna'],connectionVersionId:'c',executable:true}]}]}};
async function conversation(){
 const receipts=await Promise.all(modelCommand.mock.results.map(async(result,index)=>({value:await result.value,data:modelCommand.mock.calls[index][1]})));
 const completed=receipts.filter(receipt=>receipt.value?.status==='completed'),latest=completed.at(-1)?.value;
 return{turns:completed.map(({value,data})=>({requestId:value.requestId,mode:data.mode,instruction:data.instruction||'优化拍法',answer:value.plan?.summary??value.message,status:value.status})),result:[...completed].reverse().find(receipt=>receipt.value.plan)?.value??null,latest,latestRequestId:latest?.requestId,mode:'optimize'};
}
function setup(){sessionList.mockImplementation(async()=>({conversations:(await conversation()).latest?[{id:null,number:1,createdAt:'2026-11-18T00:00:00.000Z'}]:[]}));request.mockImplementation(async(path:string)=>path==='connections'?catalog:conversation());modelCommand.mockResolvedValue({requestId:'plan',status:'completed',plan});const props={episodeId:'chat-episode',scriptRevisionId:null,script:source,stage:'waiting_input',readOnly:false,pending:false,command:vi.fn(),onConfirmed:vi.fn()};return{...render(<WorkspaceDraftProvider ownerId="chat-owner"><WorkspaceScriptPanel {...props}/></WorkspaceDraftProvider>),props};}
async function ready(){await waitFor(()=>expect(request.mock.calls.some(([path])=>path==='script-studio')).toBe(true));await waitFor(()=>expect(screen.getByRole('textbox',{name:'修改要求'})).toHaveProperty('disabled',false));}
afterEach(()=>{cleanup();localStorage.clear();vi.resetAllMocks();});
it('places production controls above and below the three panes and model selection inside a collapsible chat',async()=>{
 setup();const toolbar=screen.getByRole('toolbar',{name:'脚本工具'}),chat=screen.getByRole('complementary',{name:'拍法助手'});
 expect(within(toolbar).getByLabelText('目标时长')).toBeTruthy();expect(within(toolbar).queryByRole('button',{name:/上传脚本/})).toBeNull();expect(screen.getByRole('form',{name:'脚本正文'}).contains(screen.getByRole('button',{name:'上传脚本'}))).toBe(true);expect(within(chat).getByRole('button',{name:'选择大语言模型'})).toBeTruthy();expect(screen.getByRole('group',{name:'制作操作'}).contains(screen.getByRole('button',{name:'继续制作'}))).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'收起拍法助手'}));expect(screen.queryByRole('textbox',{name:'修改要求'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'展开拍法助手'}));expect(screen.getByRole('textbox',{name:'修改要求'})).toBeTruthy();expect(modelCommand).not.toHaveBeenCalled();
});
it('discusses inline without replacing the adoptable plan and chains subsequent adjustments',async()=>{
 setup();await ready();await waitFor(()=>expect(screen.getByRole('button',{name:'优化拍法'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'采用并继续'});
 modelCommand.mockResolvedValueOnce({requestId:'talk',status:'completed',message:'保留连续镜头更舒缓。'});await setMode('自由交流');fireEvent.change(screen.getByRole('textbox',{name:'修改要求'}),{target:{value:'再舒缓一点可以吗？'}});fireEvent.submit(screen.getByRole('form',{name:'拍法对话'}));await screen.findByText('保留连续镜头更舒缓。');await waitFor(()=>expect(screen.getByRole('button',{name:'采用并继续'})).toHaveProperty('disabled',false));expect(screen.queryByRole('dialog')).toBeNull();
 await setMode('调整拍法');fireEvent.change(screen.getByRole('textbox',{name:'修改要求'}),{target:{value:'按这个修改'}});fireEvent.submit(screen.getByRole('form',{name:'拍法对话'}));await waitFor(()=>expect(modelCommand).toHaveBeenLastCalledWith('optimize',expect.objectContaining({instruction:'按这个修改',previousRequestId:'talk'}),undefined,'script-studio'));
});
it('preserves an unsent chat draft and never sends while confirming Chinese input',async()=>{
 const view=setup();const input=screen.getByRole('textbox',{name:'修改要求'});await ready();await waitFor(()=>expect(input).toHaveProperty('disabled',false));fireEvent.change(input,{target:{value:'保留原文口播'}});fireEvent.keyDown(input,{key:'Enter',isComposing:true,keyCode:229});expect(modelCommand).not.toHaveBeenCalled();view.unmount();setup();await waitFor(()=>expect(screen.getByRole('textbox',{name:'修改要求'})).toHaveProperty('value','保留原文口播'));expect(modelCommand).not.toHaveBeenCalled();
});
async function setMode(label:string){await waitFor(()=>expect(screen.getByRole('button',{name:/^交流方式：/})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:/^交流方式：/}));fireEvent.click(screen.getByRole('button',{name:label}));fireEvent.click(screen.getByRole('button',{name:'关闭'}));}
it('retires the adaptation controls while preserving old unsent drafts',async()=>{
 const initial={instruction:'',mode:'adjust',adapt:''};localStorage.setItem('loop-control.workspace-draft.v1:'+JSON.stringify(['chat-owner','chat-episode','script','chat:new']),JSON.stringify({baseline:JSON.stringify(initial),value:{...initial,instruction:'保留口播',adapt:'yes'}}));setup();await ready();await waitFor(()=>expect(screen.getByRole('textbox',{name:'修改要求'})).toHaveProperty('value','保留口播'));expect(screen.queryByText('更多选项')).toBeNull();expect(screen.queryByRole('checkbox',{name:'允许大胆改编'})).toBeNull();await waitFor(()=>expect(screen.getByRole('button',{name:'优化拍法'})).toHaveProperty('disabled',false));fireEvent.submit(screen.getByRole('form',{name:'拍法对话'}));await waitFor(()=>expect(modelCommand).toHaveBeenCalledWith('optimize',expect.objectContaining({mode:'optimize',instruction:'保留口播'}),undefined,'script-studio'));expect(screen.queryByRole('dialog',{name:'确认大胆改编'})).toBeNull();
});
it('sends a selected native reasoning effort without dispatching on configuration changes',async()=>{
 setup();await waitFor(()=>expect(screen.getByRole('button',{name:'推理强度：关闭'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'推理强度：关闭'}));fireEvent.change(screen.getByRole('slider',{name:'推理强度'}),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'关闭'}));expect(modelCommand).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await waitFor(()=>expect(modelCommand).toHaveBeenCalledWith('optimize',expect.objectContaining({reasoningEffort:'high'}),undefined,'script-studio'));
});
it('keeps warnings with the filming explanation and duration help inside the field',async()=>{
 setup();await ready();modelCommand.mockResolvedValue({requestId:'warn',status:'completed',plan:{...plan,warnings:['需补充画面来源']}});await waitFor(()=>expect(screen.getByRole('button',{name:'优化拍法'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await screen.findByRole('button',{name:'拍法说明'});expect(screen.queryByText('需补充画面来源')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'拍法说明'}));expect(within(screen.getByRole('dialog',{name:'拍法说明'})).getByText('需补充画面来源')).toBeTruthy();expect(screen.getByLabelText('目标时长')).toHaveProperty('placeholder','自动时长');expect(screen.queryByRole('button',{name:'目标时长说明'})).toBeNull();
});
it('shows only native effort levels for the chosen provider and keeps choices separate per model',async()=>{
 setup();await waitFor(()=>expect(screen.getByRole('button',{name:'选择大语言模型'}).textContent).toContain('gpt-5.6-luna'));
 const first=catalog.serviceCatalog.groups[0].services[0];request.mockImplementation(async(path:string)=>path==='connections'?{serviceCatalog:{groups:[{capability:'language_model',services:[first,{...first,id:'deepseek',provider:'deepseek',adapter:'deepseek_responses',models:['deepseek-flash']}]}]}}:{turns:[],result:null,mode:'optimize'});
 await waitFor(()=>expect(screen.getByRole('button',{name:'推理强度：关闭'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'推理强度：关闭'}));fireEvent.change(screen.getByRole('slider',{name:'推理强度'}),{target:{value:'4'}});fireEvent.click(screen.getByRole('button',{name:'关闭'}));fireEvent.click(screen.getByRole('button',{name:'选择大语言模型'}));fireEvent.click(screen.getByRole('button',{name:'刷新模型连接'}));fireEvent.click(await screen.findByRole('button',{name:/DeepSeek deepseek-flash/}));fireEvent.click(screen.getByRole('button',{name:'推理强度：关闭'}));const popup=screen.getByRole('dialog',{name:'推理强度'});expect(within(popup).getByRole('slider',{name:'推理强度'})).toHaveProperty('max','3');expect(within(popup).queryByText('中')).toBeNull();expect(within(popup).queryByText('更高')).toBeNull();fireEvent.change(within(popup).getByRole('slider',{name:'推理强度'}),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:'关闭'}));fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await waitFor(()=>expect(modelCommand).toHaveBeenCalledWith('optimize',expect.objectContaining({reasoningEffort:'low',selection:expect.objectContaining({provider:'deepseek'})}),undefined,'script-studio'));
});

it('uses low as the effective default for GPT-6.1 Sol and never offers disabled reasoning',async()=>{
 setup();await waitFor(()=>expect(screen.getByRole('button',{name:'推理强度：关闭'})).toHaveProperty('disabled',false));const first=catalog.serviceCatalog.groups[0].services[0];request.mockImplementation(async(path:string)=>path==='connections'?{serviceCatalog:{groups:[{capability:'language_model',services:[first,{...first,id:'sol',models:['gpt-6.1-sol']}]}]}}:{turns:[],result:null,mode:'optimize'});fireEvent.click(screen.getByRole('button',{name:'选择大语言模型'}));fireEvent.click(screen.getByRole('button',{name:'刷新模型连接'}));fireEvent.click(await screen.findByRole('button',{name:/OpenAI gpt-6.1-sol/}));fireEvent.click(screen.getByRole('button',{name:'推理强度：低'}));expect(screen.getByRole('slider',{name:'推理强度'})).toHaveProperty('max','4');expect(screen.getByRole('slider',{name:'推理强度'}).getAttribute('aria-valuetext')).toBe('低');fireEvent.click(screen.getByRole('button',{name:'关闭'}));fireEvent.click(screen.getByRole('button',{name:'优化拍法'}));await waitFor(()=>expect(modelCommand).toHaveBeenCalledWith('optimize',expect.objectContaining({reasoningEffort:'low',selection:expect.objectContaining({model:'gpt-6.1-sol'})}),undefined,'script-studio'));
});

it('numbers the first implicit conversation after sending and clears the accepted instruction',async()=>{
 setup();const input=screen.getByRole('textbox',{name:'修改要求'});await ready();await waitFor(()=>expect(input).toHaveProperty('disabled',false));
 expect(screen.queryByRole('button',{name:'对话 1'})).toBeNull();fireEvent.change(input,{target:{value:'用空座位表现等待'}});
 fireEvent.submit(screen.getByRole('form',{name:'拍法对话'}));
 await screen.findByRole('button',{name:'对话 1'});await waitFor(()=>expect(input).toHaveProperty('value',''));
 await waitFor(()=>expect(input).toHaveProperty('disabled',false));expect(modelCommand).toHaveBeenCalledOnce();
 expect(screen.getByRole('button',{name:'对话 1'}).getAttribute('aria-pressed')).toBe('true');
 expect(screen.getByRole('list',{name:'拍法对话记录'}).textContent).toContain('用空座位表现等待');
});

it('keeps the in-memory unsent chat draft through upload pending even when local storage is unavailable',async()=>{
 const view=setup();const input=screen.getByRole('textbox',{name:'修改要求'});await ready();await waitFor(()=>expect(input).toHaveProperty('disabled',false));
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('storage unavailable');});
 try{
  fireEvent.change(input,{target:{value:'只在内存中的要求'}});
  view.rerender(<WorkspaceDraftProvider ownerId="chat-owner"><WorkspaceScriptPanel {...view.props} pending/></WorkspaceDraftProvider>);
  expect(input).toHaveProperty('disabled',true);expect(input).toHaveProperty('value','只在内存中的要求');
  view.rerender(<WorkspaceDraftProvider ownerId="chat-owner"><WorkspaceScriptPanel {...view.props}/></WorkspaceDraftProvider>);
  await waitFor(()=>expect(input).toHaveProperty('disabled',false));expect(input).toHaveProperty('value','只在内存中的要求');expect(modelCommand).not.toHaveBeenCalled();
 }finally{storage.mockRestore();}
});

it('offers general conversation without dispatching until an explicit text send',async()=>{
 setup();await ready();modelCommand.mockResolvedValueOnce({requestId:'general-chat',status:'completed',message:'可以先读二十分钟，再做练习。'});
 await setMode('自由交流');const input=screen.getByRole('textbox',{name:'修改要求'});expect(input).toHaveProperty('placeholder','想聊什么都可以…');expect(modelCommand).not.toHaveBeenCalled();
 fireEvent.change(input,{target:{value:'明天的学习计划怎么安排？'}});fireEvent.submit(screen.getByRole('form',{name:'拍法对话'}));await screen.findByText('可以先读二十分钟，再做练习。');
 expect(modelCommand).toHaveBeenCalledWith('optimize',expect.objectContaining({mode:'discuss',instruction:'明天的学习计划怎么安排？'}),undefined,'script-studio');expect(screen.queryByRole('button',{name:'采用并继续'})).toBeNull();
});
