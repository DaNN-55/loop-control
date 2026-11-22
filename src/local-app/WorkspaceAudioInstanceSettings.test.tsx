import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceAudioInstanceSettings} from './WorkspaceAudioInstanceSettings';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
const project={assets:[{id:'a',kind:'audio',durationInFrames:240}],timelines:[{fps:30,items:[{id:'v',kind:'video',startFrame:60},{id:'s',kind:'audio',sourceAssetId:'a',srcInFrame:30,playbackRate:2,loopControlAudio:{anchor:'shot'}}]}]} as unknown as OpenChatCutProject;
const sound={itemId:'s',kind:'sfx' as const,startSeconds:2,durationSeconds:2,gainDb:-6,duckDepthDb:5};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('saves source in and rate-adjusted duration only on apply, and reopens the saved window',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 const apply=vi.fn(async()=>true),closed=vi.fn();const props={sound,project,workspaceId:'w',shotId:'S1',shotItemIds:['v'],disabled:false,apply,onApplied:closed,src:'/test.mp3'};
 const view=render(<WorkspaceAudioInstanceSettings {...props}/>);fireEvent.click(screen.getByRole('button',{name:'裁剪'}));fireEvent.click(screen.getByRole('button',{name:'精确时间'}));
 expect(screen.getByRole('spinbutton',{name:'音频使用起点（秒）'})).toHaveProperty('value','1');
 fireEvent.change(screen.getByRole('spinbutton',{name:'音频使用起点（秒）'}),{target:{value:'2'}});fireEvent.change(screen.getByRole('spinbutton',{name:'音频使用终点（秒）'}),{target:{value:'6'}});expect(apply).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'应用设置'}));await waitFor(()=>expect(closed).toHaveBeenCalledOnce());expect(apply).toHaveBeenCalledWith(expect.objectContaining({placement:{anchor:'shot',shotId:'S1',offsetSeconds:0,sourceInSeconds:2,durationSeconds:2}}));
 view.unmount();render(<WorkspaceAudioInstanceSettings {...props} project={{...project,timelines:[{...project.timelines[0],items:project.timelines[0].items.map(i=>i.id==='s'?{...i,srcInFrame:60}:i)}]}}/>);fireEvent.click(screen.getByRole('button',{name:'裁剪'}));fireEvent.click(screen.getByRole('button',{name:'精确时间'}));expect(screen.getByRole('spinbutton',{name:'音频使用起点（秒）'})).toHaveProperty('value','2');expect(screen.getByRole('spinbutton',{name:'音频使用终点（秒）'})).toHaveProperty('value','6');
});
