import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceShotPreview} from './WorkspaceShotPreview';
import type {ProductionWorkspace,WorkspaceClip} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const clip:WorkspaceClip={id:'clip',shotId:'S1',itemId:'item',text:'画面',source:{kind:'video',relativePath:'episodes/e/source.mp4',sha256:'source-sha',fileSize:20,materialRevisionId:'material'}};
const workspace={episodeId:'e'} as ProductionWorkspace;
const project={timelines:[{fps:30,items:[{id:'item',kind:'video',src:'episodes/e/source.mp4',sourceContentHash:'source-sha',srcInFrame:60,durationInFrames:90}]}]} as unknown as OpenChatCutProject;
it('previews the registered bytes and selected source interval without changing the project',()=>{
 render(<WorkspaceShotPreview workspace={workspace} clips={[clip]} project={project} onSelect={vi.fn()}/>);const video=screen.getByLabelText('S1 当前视频') as HTMLVideoElement;expect(video.src).toContain('sha256=source-sha');expect(screen.getByText('使用 2.00–5.00 s')).toBeTruthy();Object.defineProperty(video,'duration',{value:20});fireEvent.loadedMetadata(video);expect(video.currentTime).toBe(2);video.currentTime=5;fireEvent.play(video);expect(video.currentTime).toBe(2);const pause=vi.spyOn(video,'pause').mockImplementation(()=>{});Object.defineProperty(video,'paused',{value:false});video.currentTime=5;fireEvent.timeUpdate(video);expect(pause).toHaveBeenCalledTimes(1);
});
it('keeps clip selection available for viewing multiple references',()=>{
 const onSelect=vi.fn();render(<WorkspaceShotPreview workspace={workspace} clips={[clip,{...clip,id:'second',itemId:'second'}]} selectedItemId="item" project={project} onSelect={onSelect}/>);fireEvent.change(screen.getByRole('combobox',{name:'预览画面片段'}),{target:{value:'second'}});expect(onSelect).toHaveBeenCalledWith('second');
});

it('previews the saved video after adopting it over an original image binding',()=>{
 const original={...clip,source:{...clip.source!,kind:'image' as const,relativePath:'old.png'}};
 const saved={timelines:[{fps:30,items:[{id:'item',kind:'video',src:'new.mp4',sourceContentHash:'new-sha',durationInFrames:90}]}],assets:[]} as unknown as OpenChatCutProject;
 render(<WorkspaceShotPreview workspace={workspace} clips={[original]} project={saved} materials={[{storage_path:'new.mp4',source_path:'上传视频.mp4'}]} onSelect={vi.fn()}/>);
 const video=screen.getByLabelText('S1 当前视频') as HTMLVideoElement;expect(video.src).toContain('path=new.mp4&sha256=new-sha');expect(screen.queryByRole('img')).toBeNull();expect(screen.getByText('上传视频.mp4')).toBeTruthy();
});

it('respects a saved 2x visual speed and its six-second source window',()=>{
 const sped={...project,timelines:[{...project.timelines[0],items:[{...project.timelines[0].items[0],playbackRate:2}]}]} as OpenChatCutProject;
 render(<WorkspaceShotPreview workspace={workspace} clips={[clip]} project={sped} onSelect={vi.fn()}/>);
 const video=screen.getByLabelText('S1 当前视频') as HTMLVideoElement;Object.defineProperty(video,'duration',{value:20});fireEvent.loadedMetadata(video);expect(video.playbackRate).toBe(2);expect(video.currentTime).toBe(2);expect(screen.getByText('使用 2.00–8.00 s')).toBeTruthy();
 const pause=vi.spyOn(video,'pause').mockImplementation(()=>{});Object.defineProperty(video,'paused',{value:false});video.currentTime=5;fireEvent.timeUpdate(video);expect(pause).not.toHaveBeenCalled();video.currentTime=8.2;fireEvent.timeUpdate(video);expect(pause).toHaveBeenCalledOnce();expect(video.currentTime).toBe(8);
});
