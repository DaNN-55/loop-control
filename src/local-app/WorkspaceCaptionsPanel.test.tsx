import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceCaptionsPanel} from './WorkspaceCaptionsPanel';
import {defaultShotCaptionContract} from '../shotCaptions';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(cleanup);
it('keeps timing explicit when text changes and sends saved native cues through the Owner command',async()=>{
 const contract=defaultShotCaptionContract('原字幕','independent');contract.cues=[{id:'cue',text:'原字幕',startMs:0,endMs:800}];
 const workspace={id:'w',episodeId:'e',revision:2,clips:[{id:'c',itemId:'native',shotId:'S1',text:'口播',source:null}],captions:[{clipId:'c',itemId:'native',shotId:'S1',contract,inputFingerprint:'a'.repeat(64),timing:'current',textConfirmed:false,audioTrackId:null,narrationText:null,taskId:null,alignmentInputVersion:null,detail:null,durationMs:2000}]} as unknown as ProductionWorkspace;
 const command=vi.fn(async()=>workspace);render(<WorkspaceCaptionsPanel workspace={workspace} command={command} onChange={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('字幕正文'),{target:{value:'新的正文'}});expect(screen.queryByLabelText('字幕条目 1 开始（秒）')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'添加字幕条目'}));expect((screen.getByLabelText('字幕条目 1 正文') as HTMLInputElement).value).toBe('新的正文');
 fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceCaptions',expect.objectContaining({clipId:'c',captionContract:expect.objectContaining({text:'新的正文',cues:[expect.objectContaining({text:'新的正文'})]})})));
});

it('keeps only alignment actions in Studio without duplicate text, style or approval inputs',()=>{
 const contract=defaultShotCaptionContract('原生字幕','independent');
 const workspace={id:'w',episodeId:'e',revision:2,clips:[{id:'c',itemId:'native',shotId:'S1',text:'口播'}],captions:[{clipId:'c',itemId:'native',shotId:'S1',contract,inputFingerprint:'a',timing:'current',textConfirmed:false,audioTrackId:'voice',taskId:null}]} as unknown as ProductionWorkspace;
 render(<WorkspaceCaptionsPanel workspace={workspace} alignmentOnly command={vi.fn()} onChange={()=>{}}/>);
 expect(screen.getByRole('button',{name:'声学对齐'})).toBeTruthy();expect(screen.queryByLabelText('字幕正文')).toBeNull();expect(screen.queryByLabelText('字幕位置')).toBeNull();expect(screen.queryByRole('button',{name:'正文已核对'})).toBeNull();expect(screen.queryByRole('button',{name:'保存字幕'})).toBeNull();
});

it('lets completed-project readers switch saved captions without exposing editing actions',()=>{
 const contract=defaultShotCaptionContract('第一段字幕','independent');contract.cues=[{id:'cue',text:'第一段字幕',startMs:100,endMs:900}];
 const workspace={id:'w',episodeId:'e',revision:2,clips:[{id:'c1',itemId:'v1',shotId:'S1',text:'镜头一'},{id:'c2',itemId:'v2',shotId:'S2',text:'镜头二'}],captions:[{shotId:'S1',contract,timing:'current',textConfirmed:true},{shotId:'S2',contract:{...contract,text:'第二段字幕',cues:[]},timing:'stale',textConfirmed:false,detail:'请核对时序'}]} as unknown as ProductionWorkspace;
 const command=vi.fn();render(<WorkspaceCaptionsPanel workspace={workspace} command={command} onChange={()=>{}} readOnly/>);
 expect(screen.getByLabelText('字幕正文').textContent).toBe('第一段字幕');expect(screen.getByRole('table',{name:'已保存字幕时序'})).toBeTruthy();expect(screen.queryByRole('button',{name:'保存字幕'})).toBeNull();
 fireEvent.change(screen.getByRole('combobox',{name:'字幕片段'}),{target:{value:'c2'}});expect(screen.getByLabelText('字幕正文').textContent).toBe('第二段字幕');expect(screen.getByRole('alert').textContent).toBe('请核对时序');expect(screen.queryByRole('table',{name:'已保存字幕时序'})).toBeNull();expect(command).not.toHaveBeenCalled();
});

function editableWorkspace(){
 const contract=defaultShotCaptionContract('字幕内容','independent');contract.spatial.safeArea='custom';contract.cues=[{id:'one',text:'字幕内容',startMs:100,endMs:900}];
 return {id:'w',episodeId:'e',revision:2,clips:[{id:'c',itemId:'v1',shotId:'S1',text:'镜头一'}],captions:[{shotId:'S1',contract,durationMs:2000,inputFingerprint:'original',timing:'current',textConfirmed:false}]} as unknown as ProductionWorkspace;
}
it('edits percentage margins without changing their spatial meaning and shows seconds in timing columns',async()=>{
 const workspace=editableWorkspace(),command=vi.fn(async()=>workspace);render(<WorkspaceCaptionsPanel workspace={workspace} command={command} onChange={()=>{}}/>);
 const bottom=screen.getByRole('spinbutton',{name:'字幕下边距（%）'}) as HTMLInputElement;
 expect(bottom.value).toBe('18');expect(bottom.max).toBe('40');
 fireEvent.change(bottom,{target:{value:'20'}});fireEvent.click(screen.getByText('手工校时'));
 expect(screen.getByRole('columnheader',{name:'正文'})).toBeTruthy();expect(screen.getByRole('columnheader',{name:'开始（秒）'})).toBeTruthy();expect(screen.getByRole('columnheader',{name:'结束（秒）'})).toBeTruthy();
 expect((screen.getByLabelText('字幕条目 1 开始（秒）') as HTMLInputElement).value).toBe('0.1');
 fireEvent.change(screen.getByLabelText('字幕条目 1 结束（秒）'),{target:{value:'1.25'}});
 fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceCaptions',expect.objectContaining({captionContract:expect.objectContaining({spatial:expect.objectContaining({insets:expect.objectContaining({bottom:.2})}),cues:[expect.objectContaining({startMs:100,endMs:1250})]})})));
});
it('keeps invalid fields visible, blocks saving, and revalidates timing when the shot window changes',async()=>{
 const workspace=editableWorkspace(),command=vi.fn(),view=render(<WorkspaceCaptionsPanel workspace={workspace} command={command} onChange={()=>{}}/>);
 fireEvent.click(screen.getByText('手工校时'));
 const bottom=screen.getByLabelText('字幕下边距（%）');fireEvent.change(bottom,{target:{value:''}});
 expect(screen.getByText('下边距不能为空。')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));expect(command).not.toHaveBeenCalled();
 fireEvent.change(bottom,{target:{value:'41'}});expect(screen.getByText('下边距须为 0–40%。')).toBeTruthy();fireEvent.change(bottom,{target:{value:'18'}});
 const start=screen.getByLabelText('字幕条目 1 开始（秒）');fireEvent.change(start,{target:{value:''}});expect(screen.getByText('第 1 条开始时间不能为空。')).toBeTruthy();
 fireEvent.change(start,{target:{value:'-0.1'}});expect(screen.getByText('第 1 条开始时间须为不小于 0 的秒数。')).toBeTruthy();
 fireEvent.change(start,{target:{value:'1'}});expect(screen.getByText('第 1 条结束时间须晚于开始时间。')).toBeTruthy();
 fireEvent.change(bottom,{target:{value:'20'}});expect((start as HTMLInputElement).value).toBe('1');expect(screen.getByText('第 1 条结束时间须晚于开始时间。')).toBeTruthy();
 fireEvent.change(start,{target:{value:'0.1'}});view.rerender(<WorkspaceCaptionsPanel workspace={{...workspace,captions:workspace.captions!.map(c=>({...c,durationMs:500,inputFingerprint:'shorter'}))}} command={command} onChange={()=>{}}/>);
 expect(screen.getByText('第 1 条结束时间超出当前镜头窗口（0.5 秒），请重新校时。')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));expect(command).not.toHaveBeenCalled();
});
