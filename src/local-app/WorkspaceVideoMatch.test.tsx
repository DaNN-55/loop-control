import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {WorkspaceVideoMatch} from './WorkspaceVideoMatch';
afterEach(cleanup);
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

function rangeProps(start=0){return {shotId:'S01',clips:[{id:'clip',itemId:'item',shotId:'S01',text:'镜头',source:{materialRevisionId:'media',relativePath:'video.mp4',sha256:'hash',fileSize:1,kind:'video' as const}}],items:[{id:'item',kind:'video',srcInFrame:start,durationInFrames:30}],assets:[{id:'material-media',durationInFrames:120}],materials:[{id:'media',material_type:'video',source_path:'video.mp4'}],disabled:false,command:vi.fn(async()=>({id:'w'})),onSaved:vi.fn()};}
it('preserves unsaved ranges across an unrelated project refresh and synchronizes a clean saved source',()=>{
 const props=rangeProps(),view=render(<WorkspaceVideoMatch {...props}/>);fireEvent.click(screen.getByRole('button',{name:'第 1 段 起点增加一帧'}));view.rerender(<WorkspaceVideoMatch {...props} clips={[...props.clips]} items={[...props.items]}/>);expect((screen.getByLabelText('第 1 段 起始帧') as HTMLInputElement).value).toBe('1');view.unmount();
 const clean=render(<WorkspaceVideoMatch {...props}/>);clean.rerender(<WorkspaceVideoMatch {...rangeProps(12)}/>);expect((screen.getByLabelText('第 1 段 起始帧') as HTMLInputElement).value).toBe('12');
});
it('preserves a dirty edit and requires explicit reload if its persisted source changed',()=>{
 const props=rangeProps(),view=render(<WorkspaceVideoMatch {...props}/>);fireEvent.click(screen.getByRole('button',{name:'第 1 段 起点增加一帧'}));view.rerender(<WorkspaceVideoMatch {...rangeProps(12)}/>);expect((screen.getByLabelText('第 1 段 起始帧') as HTMLInputElement).value).toBe('1');expect((screen.getByRole('button',{name:'保存视频区间'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'重新载入已保存区间'}));expect((screen.getByLabelText('第 1 段 起始帧') as HTMLInputElement).value).toBe('12');expect(screen.queryByRole('alert')).toBeNull();
});
