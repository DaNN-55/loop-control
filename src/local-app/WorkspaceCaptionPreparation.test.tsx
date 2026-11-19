import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceCaptionsPanel} from './WorkspaceCaptionsPanel';
import {defaultShotCaptionContract,isValidShotCaptionContract} from '../shotCaptions';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(()=>{cleanup();sessionStorage.clear();});
function fixture(){
 const contract=defaultShotCaptionContract('第一句。第二句。','independent');
 return {id:'w',episodeId:'e',revision:1,clips:[{id:'c',itemId:'v',shotId:'S1',text:'正文'}],captions:[{clipId:'c',itemId:'v',shotId:'S1',contract,durationMs:2000,inputFingerprint:'fp',timing:'failed',audioTrackId:'a',detail:'模型未完成'}]} as unknown as ProductionWorkspace;
}
it('offers direct manual correction after alignment failed without an LLM or a retry',async()=>{
 const workspace=fixture(),command=vi.fn(async()=>workspace);
 render(<WorkspaceCaptionsPanel workspace={workspace} selectedShotId="S1" alignmentOnly command={command} onChange={()=>{}}/>);
 expect(screen.queryByRole('button',{name:'声学对齐'})).toBeNull();expect(screen.queryByRole('button',{name:'采用对齐'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'调整字幕'}));
 fireEvent.change(screen.getByLabelText('第 1 句字幕'),{target:{value:'修改第一句。'}});
 fireEvent.change(screen.getByLabelText('第 1 句消失时间（秒）'),{target:{value:'0.8'}});
 fireEvent.click(screen.getByRole('button',{name:'保存调整'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceCaptions',expect.objectContaining({captionContract:expect.objectContaining({text:'修改第一句。第二句。',cues:[expect.objectContaining({text:'修改第一句。',startMs:0,endMs:800}),expect.objectContaining({text:'第二句。',startMs:1000,endMs:2000})]})})));
 expect(command.mock.calls.map(([name])=>name)).toEqual(['saveWorkspaceCaptions']);
});
it('shows readiness without claiming a human reviewed it and keeps controls collapsed',()=>{
 const workspace=fixture();workspace.captions![0].timing='current';workspace.captions![0].alignmentMethod='manual';
 render(<WorkspaceCaptionsPanel workspace={workspace} selectedShotId="S1" alignmentOnly command={vi.fn()} onChange={()=>{}}/>);
 expect(screen.getByText('字幕已就绪 · 已手工调整')).toBeTruthy();expect(screen.queryByLabelText('第 1 句字幕')).toBeNull();expect(screen.queryByRole('button',{name:'正文已核对'})).toBeNull();
});
it('uses the adopted source offset and playback rate when setting a subtitle boundary',()=>{
 const workspace=fixture();workspace.captions![0].audioPreview={relativePath:'voice.mp3',startSeconds:5,durationSeconds:2,playbackRate:2,offsetSeconds:.2};
 render(<WorkspaceCaptionsPanel workspace={workspace} selectedShotId="S1" alignmentOnly command={vi.fn()} onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'调整字幕'}));
 fireEvent.timeUpdate(screen.getByLabelText('播放当前声音并核对字幕'),{target:{currentTime:6.2}});
 fireEvent.click(screen.getAllByRole('button',{name:'从这里出现'})[0]);
 expect((screen.getByLabelText('第 1 句出现时间（秒）') as HTMLInputElement).value).toBe('0.8');
});
it('restores an unsaved adjustment across refresh and sends its original identity for server validation',async()=>{
 const workspace=fixture(),command=vi.fn(async()=>workspace),props={workspace,selectedShotId:'S1',alignmentOnly:true,command,onChange:()=>{}};
 const first=render(<WorkspaceCaptionsPanel {...props}/>);fireEvent.click(screen.getByRole('button',{name:'调整字幕'}));
 fireEvent.change(screen.getByLabelText('第 1 句字幕'),{target:{value:'刷新保留。'}});first.unmount();
 render(<WorkspaceCaptionsPanel {...props}/>);expect((screen.getByLabelText('第 1 句字幕') as HTMLInputElement).value).toBe('刷新保留。');
 fireEvent.click(screen.getByRole('button',{name:'保存调整'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceCaptions',expect.objectContaining({expectedInputFingerprint:'fp'})));
});
it('normalizes real model suggestion metadata before saving a manual correction',async()=>{
 const workspace=fixture();workspace.captions![0].suggestedCues=[{id:'one',text:'第一句。',endMs:900,startMs:100,confidence:.44},{id:'two',text:'第二句。',endMs:1900,startMs:1000,confidence:.47}] as any;
 const command=vi.fn(async(_name:string,_data:unknown)=>workspace);render(<WorkspaceCaptionsPanel workspace={workspace} selectedShotId="S1" alignmentOnly command={command} onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'调整字幕'}));fireEvent.change(screen.getByLabelText('第 1 句字幕'),{target:{value:'人工修正。'}});fireEvent.click(screen.getByRole('button',{name:'保存调整'}));
 await waitFor(()=>expect(command).toHaveBeenCalled());const data=command.mock.calls[0][1] as any;expect(isValidShotCaptionContract(data.captionContract)).toBe(true);expect(data.captionContract.cues[0]).toEqual({id:'one',text:'人工修正。',startMs:100,endMs:900});
});
it('recovers an existing model-metadata draft after refresh without losing the owner edits',async()=>{
 const workspace=fixture(),contract={...workspace.captions![0].contract,text:'已手工改字。第二句。',cues:[{id:'one',text:'已手工改字。',endMs:850,startMs:150,confidence:.44},{id:'two',text:'第二句。',endMs:1800,startMs:1000,confidence:.47}]};
 sessionStorage.setItem('loop-caption-adjustment:w:S1',JSON.stringify({inputFingerprint:'fp',contract}));
 const command=vi.fn(async(_name:string,_data:unknown)=>workspace);render(<WorkspaceCaptionsPanel workspace={workspace} selectedShotId="S1" alignmentOnly command={command} onChange={()=>{}}/>);
 expect((screen.getByLabelText('第 1 句字幕') as HTMLInputElement).value).toBe('已手工改字。');expect((screen.getByLabelText('第 1 句出现时间（秒）') as HTMLInputElement).value).toBe('0.15');
 fireEvent.click(screen.getByRole('button',{name:'保存调整'}));await waitFor(()=>expect(command).toHaveBeenCalled());expect(isValidShotCaptionContract((command.mock.calls[0][1] as any).captionContract)).toBe(true);
});
it('preserves unsaved phrase text and timing through StrictMode refresh effects',()=>{
 const workspace=fixture(),command=vi.fn(),props={workspace,selectedShotId:'S1',alignmentOnly:true,command,onChange:vi.fn()};
 const first=render(<StrictMode><WorkspaceCaptionsPanel {...props}/></StrictMode>);
 fireEvent.click(screen.getByRole('button',{name:'调整字幕'}));fireEvent.change(screen.getByLabelText('第 1 句字幕'),{target:{value:'你好，'}});fireEvent.change(screen.getByLabelText('第 1 句消失时间（秒）'),{target:{value:'0.45'}});fireEvent.change(screen.getByLabelText('第 2 句出现时间（秒）'),{target:{value:'0.82'}});
 expect(sessionStorage.getItem('loop-caption-adjustment:w:S1')).toContain('你好，');first.unmount();
 render(<StrictMode><WorkspaceCaptionsPanel {...props}/></StrictMode>);
 expect((screen.getByLabelText('第 1 句字幕') as HTMLInputElement).value).toBe('你好，');expect((screen.getByLabelText('第 1 句消失时间（秒）') as HTMLInputElement).value).toBe('0.45');expect((screen.getByLabelText('第 2 句出现时间（秒）') as HTMLInputElement).value).toBe('0.82');expect(sessionStorage.getItem('loop-caption-adjustment:w:S1')).toContain('你好，');expect(command).not.toHaveBeenCalled();
});
it.each(['missing','outside','pending-write'] as const)('explains %s without changing timing or issuing a task',kind=>{
 const workspace=fixture(),state=workspace.captions![0];
 state.timing=kind==='pending-write'?'waiting':'stale';state.detail=null;
 if(kind==='missing')state.audioTrackId=null;
 if(kind==='outside'){state.alignmentReady=false;state.detail='声音超出当前镜头范围，请在剪辑台调整，或手工调整字幕。';}
 if(kind==='pending-write'){state.alignmentReady=true;state.alignmentStatus='completed';state.taskId='existing-task';}
 const before=structuredClone(workspace),command=vi.fn();
 render(<WorkspaceCaptionsPanel workspace={workspace} selectedShotId="S1" alignmentOnly command={command} onChange={()=>{}}/>);
 expect(screen.getByText(kind==='missing'?'缺少声音，尚未自动校时':kind==='outside'?'声音超出镜头，尚未自动校时':'字幕校时已完成，等待写回')).toBeTruthy();
 expect(screen.getByText(kind==='missing'?/请先在声音页采用/:kind==='outside'?/请到剪辑台手动调整/:/已有校时结果，无需重新识别/)).toBeTruthy();
 expect(command).not.toHaveBeenCalled();expect(workspace).toEqual(before);
});
