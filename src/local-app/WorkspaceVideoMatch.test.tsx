import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {WorkspaceVideoMatch} from './WorkspaceVideoMatch';
it('locks duration while moving the source window by one frame and saves stable references',async()=>{
 const command=vi.fn().mockResolvedValue({id:'workspace'}),onSaved=vi.fn();
 render(<WorkspaceVideoMatch shotId="S01" clips={[{id:'clip',itemId:'item',shotId:'S01',text:'镜头',source:{materialRevisionId:'media',relativePath:'video.mp4',sha256:'hash',fileSize:1,kind:'video'}}]} items={[{id:'item',kind:'video',srcInFrame:59,durationInFrames:30,loopControlVideo:{durationLocked:true}}]} assets={[{id:'material-media',durationInFrames:120}]} materials={[{id:'media',material_type:'video',source_path:'video.mp4'}]} disabled={false} command={command} onSaved={onSaved}/>);
 fireEvent.click(screen.getByRole('button',{name:'第 1 段 起点增加一帧'}));
 expect((screen.getByLabelText('第 1 段 起始帧') as HTMLInputElement).value).toBe('60');
 expect((screen.getByLabelText('第 1 段 结束帧') as HTMLInputElement).value).toBe('90');
 expect((screen.getByRole('button',{name:'第 1 段 终点增加一帧'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'保存视频区间'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('saveWorkspaceVideoRanges',{shotId:'S01',ranges:[{clipId:'clip',materialRevisionId:'media',sourceInFrame:60,durationInFrames:30,durationLocked:true}]}));
});
