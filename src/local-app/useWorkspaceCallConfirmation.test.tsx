import {useState} from 'react';
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {useWorkspaceCallConfirmation} from './useWorkspaceCallConfirmation';
const payload={episodeId:'e',workspaceId:'w',expectedRevision:3,prompt:'生成产品图'};
const proposal={confirmationId:'confirmation',expiresAt:'2099-01-01T00:00:00Z',summary:{kind:'图片生成',target:'shot-01',provider:'openai',model:'gpt-image-2',connection:'我的连接 · v1',parameters:['2 张','1152 × 2048'],inputs:['产品.png'],prompt:'生成产品图',reservationCents:125}};
function Host({command,identity='e:w'}:{command:(name:string,data:unknown)=>Promise<unknown>;identity?:string}){const call=useWorkspaceCallConfirmation(command,identity),[status,setStatus]=useState('待提交');return <><button onClick={()=>void call.request('requestWorkspaceImageCandidates',payload).then(()=>setStatus('完成')).catch(e=>setStatus(e.name==='AbortError'?'取消':'失败'))}>生成图片</button><output>{status}</output>{call.dialog}</>;}
afterEach(cleanup);
it('shows the server-resolved call and cost and cancels without submitting generation',async()=>{
 const command=vi.fn(async()=>proposal);render(<Host command={command}/>);fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await screen.findByRole('dialog',{name:'确认本次图片生成'});expect((screen.getByLabelText('本次费用预留（元）') as HTMLInputElement).value).toBe('1.25');expect(screen.getByText('产品.png')).toBeTruthy();expect(screen.getByText('gpt-image-2')).toBeTruthy();expect(command).toHaveBeenCalledWith('prepareWorkspaceCall',{episodeId:'e',workspaceId:'w',expectedRevision:3,callCommand:'requestWorkspaceImageCandidates',callData:payload});expect(command).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'取消'}));await screen.findByText('取消',{selector:'output'});expect(screen.queryByRole('dialog')).toBeNull();expect(command).toHaveBeenCalledTimes(1);
});
it('confirms only the proposal ID and locks duplicate clicks until submission finishes',async()=>{
 let done!:(value:unknown)=>void;const submitted=new Promise(resolve=>{done=resolve;}),command=vi.fn(async(name:string)=>name==='prepareWorkspaceCall'?proposal:submitted);render(<Host command={command}/>);fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'确认并提交本次调用'}));expect(screen.getByRole('button',{name:'正在提交…'}).hasAttribute('disabled')).toBe(true);fireEvent.click(screen.getByRole('button',{name:'正在提交…'}));expect(command).toHaveBeenCalledTimes(2);expect(command).toHaveBeenLastCalledWith('confirmWorkspaceCall',{episodeId:'e',workspaceId:'w',expectedRevision:3,confirmationId:'confirmation',reservationCents:125});await act(async()=>done({id:'w'}));await screen.findByText('完成');expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps an uncertain failure visible and prevents repeating its confirmation',async()=>{
 const command=vi.fn(async(name:string)=>{if(name==='prepareWorkspaceCall')return proposal;throw Error('提交结果未知');});render(<Host command={command}/>);fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'确认并提交本次调用'}));await screen.findByRole('alert');expect(screen.getByRole('button',{name:'确认并提交本次调用'}).hasAttribute('disabled')).toBe(true);expect(command).toHaveBeenCalledTimes(2);fireEvent.click(screen.getByRole('button',{name:'取消'}));await screen.findByText('取消',{selector:'output'});
});
it('abandons an open proposal when the episode changes',async()=>{
 const command=vi.fn(async()=>proposal),view=render(<Host command={command}/>);fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await screen.findByRole('dialog');view.rerender(<Host command={command} identity="other:workspace"/>);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(command).toHaveBeenCalledTimes(1);
});

it('lets the Owner adjust only the final reservation and rejects empty or fractional-cent amounts',async()=>{
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceCall'?proposal:{id:'w'});render(<Host command={command}/>);fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await screen.findByRole('dialog');
 const input=screen.getByLabelText('本次费用预留（元）'),button=screen.getByRole('button',{name:'确认并提交本次调用'});
 for(const value of ['','0','1000.01','1.001']){fireEvent.change(input,{target:{value}});expect(button.hasAttribute('disabled')).toBe(true);}
 fireEvent.change(input,{target:{value:'3.21'}});expect(button.hasAttribute('disabled')).toBe(false);fireEvent.click(button);await screen.findByText('完成');expect(command).toHaveBeenLastCalledWith('confirmWorkspaceCall',{episodeId:'e',workspaceId:'w',expectedRevision:3,confirmationId:'confirmation',reservationCents:321});
});
