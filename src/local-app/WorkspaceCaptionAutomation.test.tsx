import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceCaptionAutomation} from './WorkspaceCaptionAutomation';
import {defaultShotCaptionContract} from '../shotCaptions';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
function fixture(){
 return {id:'auto-w',episodeId:'e',revision:1,clips:[{id:'c1',itemId:'v1',shotId:'S1'},{id:'c2',itemId:'v2',shotId:'S2'}],captions:['S1','S2'].map((shotId,i)=>({clipId:'c'+(i+1),itemId:'v'+(i+1),shotId,contract:defaultShotCaptionContract('字幕','independent'),durationMs:2000,inputFingerprint:'fp'+i,timing:'stale',audioTrackId:'audio'+i,taskId:null}))} as unknown as ProductionWorkspace;
}
it('prepares two caption tracks serially and does not repeatedly submit unchanged input',async()=>{
 let saved=fixture(),active=0,maxActive=0;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:saved})));
 const command=vi.fn(async(_name:string,data:any)=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();saved={...saved,captions:saved.captions!.map(c=>c.clipId===data.clipId?{...c,timing:'waiting',taskId:'task-'+c.clipId,alignmentStatus:'running'}:c)};active--;return {workspace:saved};});
 function View(){const [workspace,setWorkspace]=useState(saved);return <WorkspaceCaptionAutomation workspace={workspace} command={command} onChange={setWorkspace}/>;}
 render(<View/>);await waitFor(()=>expect(command).toHaveBeenCalledTimes(2));expect(maxActive).toBe(1);
 expect(saved.captions!.every(c=>c.timing==='waiting')).toBe(true);
 expect(command.mock.calls.every(([name,data])=>name==='requestWorkspaceCaptionAlignment'&&data.automatic===true&&data.localOnly===true&&data.expectedInputFingerprint)).toBe(true);
});
it('rechecks authoritative manual evidence before issuing an automatic command',async()=>{
 const stale=fixture(),manual={...stale,captions:stale.captions!.map(c=>({...c,timing:'current',alignmentMethod:'manual'}))} as ProductionWorkspace;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:manual})));
 const command=vi.fn(),onChange=vi.fn();render(<WorkspaceCaptionAutomation workspace={stale} command={command} onChange={onChange}/>);
 await waitFor(()=>expect(onChange).toHaveBeenCalled());expect(command).not.toHaveBeenCalled();
});
it('never repeats an unknown automatic request after remounting the same input',async()=>{
 const workspace=fixture();workspace.captions=workspace.captions!.slice(0,1);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const command=vi.fn(async()=>{throw Error('回执未知');}),props={workspace,command,onChange:vi.fn()};
 const first=render(<WorkspaceCaptionAutomation {...props}/>);await screen.findByText('字幕自动处理未完成，可直接调整字幕或重新尝试。');first.unmount();
 render(<WorkspaceCaptionAutomation {...props}/>);await Promise.resolve();expect(command).toHaveBeenCalledTimes(1);
});
it('continues preparing other captions after one same-input attempt fails',async()=>{
 let workspace=fixture();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const command=vi.fn(async(_name:string,data:any)=>{if(data.clipId==='c1')throw Error('环境不可用');workspace={...workspace,captions:workspace.captions!.map(c=>c.clipId===data.clipId?{...c,timing:'waiting',taskId:'t',alignmentStatus:'running'}:c)};return {workspace};});
 function View(){const [current,setCurrent]=useState(workspace);return <WorkspaceCaptionAutomation workspace={current} command={command} onChange={setCurrent}/>;}
 render(<View/>);await waitFor(()=>expect(command).toHaveBeenCalledTimes(2));expect(command.mock.calls[1][1].clipId).toBe('c2');expect(screen.getByText('字幕自动处理未完成，可直接调整字幕或重新尝试。')).toBeTruthy();
});
it('clears an old automatic error after the owner supplies current manual captions',async()=>{
 const workspace=fixture();workspace.captions=workspace.captions!.slice(0,1);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const command=vi.fn(async()=>{throw Error('失败');}),props={workspace,command,onChange:vi.fn()};
 const view=render(<WorkspaceCaptionAutomation {...props}/>);await screen.findByText('字幕自动处理未完成，可直接调整字幕或重新尝试。');
 view.rerender(<WorkspaceCaptionAutomation {...props} workspace={{...workspace,captions:workspace.captions!.map(c=>({...c,timing:'current',alignmentMethod:'manual'}))}}/>);
 await waitFor(()=>expect(screen.queryByText('字幕自动处理未完成，可直接调整字幕或重新尝试。')).toBeNull());expect(command).toHaveBeenCalledTimes(1);
});
it('bounds authoritative read failures instead of retrying in a render loop',async()=>{
 const workspace=fixture();workspace.captions=workspace.captions!.slice(0,1);
 const read=vi.fn(async()=>{throw Error('offline');});vi.stubGlobal('fetch',read);
 const command=vi.fn();render(<WorkspaceCaptionAutomation workspace={workspace} command={command} onChange={vi.fn()}/>);
 await screen.findByText('字幕自动处理未完成，可直接调整字幕或重新尝试。');
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});expect(read).toHaveBeenCalledTimes(1);expect(command).not.toHaveBeenCalled();
});
it('stops after a pending read is disabled and resumes only when enabled again',async()=>{
 const workspace=fixture();workspace.captions=workspace.captions!.slice(0,1);
 let release!:(value:Response)=>void;
 const read=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{release=resolve;})).mockImplementation(async()=>Response.json({workspace}));vi.stubGlobal('fetch',read);
 const command=vi.fn(async()=>({workspace:{...workspace,captions:workspace.captions!.map(c=>({...c,timing:'waiting',taskId:'task',alignmentStatus:'running'}))}})),props={workspace,command,onChange:vi.fn()};
 const view=render(<WorkspaceCaptionAutomation {...props}/>);await waitFor(()=>expect(read).toHaveBeenCalledTimes(1));view.rerender(<WorkspaceCaptionAutomation {...props} disabled/>);
 await act(async()=>{release(Response.json({workspace}));await new Promise(resolve=>setTimeout(resolve,30));});expect(read).toHaveBeenCalledTimes(1);expect(command).not.toHaveBeenCalled();
 view.rerender(<WorkspaceCaptionAutomation {...props}/>);await waitFor(()=>expect(command).toHaveBeenCalledTimes(1));expect(read).toHaveBeenCalledTimes(2);
});

it('shows automatic-caption failures in the shared floating notice without occupying the workspace',async()=>{
 const workspace=fixture();workspace.captions=workspace.captions!.slice(0,1);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const command=vi.fn(async()=>{throw Error('环境不可用');});
 const view=render(<section aria-label="准备区"><WorkspaceCaptionAutomation workspace={workspace} command={command} onChange={vi.fn()}/></section>);
 const message=await screen.findByText('字幕自动处理未完成，可直接调整字幕或重新尝试。');
 const notice=screen.getByRole('region',{name:'通知'});
 expect(notice.contains(message)).toBe(true);
 expect(view.container.contains(message)).toBe(false);
 expect(message.closest('[role="status"]')?.getAttribute('data-tone')).toBe('warning');
 fireEvent.click(screen.getByRole('button',{name:'关闭操作提示'}));
 await waitFor(()=>expect(screen.queryByText('字幕自动处理未完成，可直接调整字幕或重新尝试。')).toBeNull());
 expect(command).toHaveBeenCalledTimes(1);
});
