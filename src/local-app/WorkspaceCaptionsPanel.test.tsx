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
 fireEvent.change(screen.getByLabelText('字幕正文'),{target:{value:'新的正文'}});expect(screen.queryByLabelText('cue 1 开始毫秒')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'添加 cue'}));expect((screen.getByLabelText('cue 1 正文') as HTMLInputElement).value).toBe('新的正文');
 fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceCaptions',expect.objectContaining({clipId:'c',captionContract:expect.objectContaining({text:'新的正文',cues:[expect.objectContaining({text:'新的正文'})]})})));
});

it('keeps only alignment actions in Studio without duplicate text, style or approval inputs',()=>{
 const contract=defaultShotCaptionContract('原生字幕','independent');
 const workspace={id:'w',episodeId:'e',revision:2,clips:[{id:'c',itemId:'native',shotId:'S1',text:'口播'}],captions:[{clipId:'c',itemId:'native',shotId:'S1',contract,inputFingerprint:'a',timing:'current',textConfirmed:false,audioTrackId:'voice',taskId:null}]} as unknown as ProductionWorkspace;
 render(<WorkspaceCaptionsPanel workspace={workspace} alignmentOnly command={vi.fn()} onChange={()=>{}}/>);
 expect(screen.getByRole('button',{name:'声学对齐'})).toBeTruthy();expect(screen.queryByLabelText('字幕正文')).toBeNull();expect(screen.queryByLabelText('字幕位置')).toBeNull();expect(screen.queryByRole('button',{name:'正文已核对'})).toBeNull();expect(screen.queryByRole('button',{name:'保存字幕'})).toBeNull();
});
