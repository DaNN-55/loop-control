import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {WorkspaceShotPreview} from './WorkspaceShotPreview';
import type {ProductionWorkspace,WorkspaceClip} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
beforeEach(()=>{vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});});
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
 const video=screen.getByLabelText('S1 当前视频') as HTMLVideoElement;Object.defineProperty(video,'duration',{value:20});fireEvent.loadedMetadata(video);expect(video.playbackRate).toBe(2);expect(video.currentTime).toBe(2);expect(screen.getByText('使用 2.00–8.00 s')).toBeTruthy();expect(screen.getByText('片段 0.00 / 3.00 s')).toBeTruthy();video.currentTime=4;fireEvent.timeUpdate(video);expect(screen.getByText('片段 1.00 / 3.00 s')).toBeTruthy();expect(screen.getByText('源视频 4.00 / 20.00 s')).toBeTruthy();
 const pause=vi.spyOn(video,'pause').mockImplementation(()=>{});Object.defineProperty(video,'paused',{value:false});video.currentTime=5;fireEvent.timeUpdate(video);expect(pause).not.toHaveBeenCalled();video.currentTime=8.2;fireEvent.timeUpdate(video);expect(pause).toHaveBeenCalledOnce();expect(video.currentTime).toBe(8);
});
it('shows honest read-only missing-source copy and static image duration without a source trim range',()=>{
 const {rerender}=render(<WorkspaceShotPreview workspace={workspace} clips={[{...clip,source:null}]} project={null} readOnly onSelect={vi.fn()}/>);
 expect(screen.getByText('此工程未保留可读取的画面来源。')).toBeTruthy();expect(screen.queryByText(/上传素材|生成视频|填入结果/)).toBeNull();
 const image={...clip,source:{...clip.source!,kind:'image' as const,relativePath:'still.png'}};
 rerender(<WorkspaceShotPreview workspace={workspace} clips={[image]} project={{...project,timelines:[{fps:30,items:[{id:'item',kind:'image',src:'still.png',sourceContentHash:'sha',durationInFrames:90}]}]} as unknown as OpenChatCutProject} readOnly onSelect={vi.fn()}/>);
 expect(screen.getByText('显示 3.00 s')).toBeTruthy();expect(screen.queryByText(/使用 0.00/)).toBeNull();
});

it('区分当前片段与源视频时间，片段内拖动不能越界，查看整段可自由定位',()=>{
 render(<WorkspaceShotPreview workspace={workspace} clips={[clip]} project={project} onSelect={vi.fn()}/>);
 const video=screen.getByLabelText('S1 当前视频') as HTMLVideoElement;
 Object.defineProperty(video,'duration',{value:20});fireEvent.loadedMetadata(video);
 expect(screen.getByText('片段 0.00 / 3.00 s')).toBeTruthy();expect(screen.getByText('源视频 2.00 / 20.00 s')).toBeTruthy();
 video.currentTime=19;fireEvent.seeking(video);expect(video.currentTime).toBe(5);
 video.currentTime=0;fireEvent.seeking(video);expect(video.currentTime).toBe(2);
 fireEvent.click(screen.getByRole('button',{name:'查看整段源视频'}));
 video.currentTime=19;fireEvent.seeking(video);expect(video.currentTime).toBe(19);
 fireEvent.click(screen.getByRole('button',{name:'仅播放当前片段'}));expect(video.currentTime).toBe(2);
 expect(JSON.stringify(project)).not.toContain('currentTime');
});
it('加载失败提供原位重试，切换片段释放原视频',()=>{
 const view=render(<WorkspaceShotPreview workspace={workspace} clips={[clip]} project={project} onSelect={vi.fn()}/>);
 const video=screen.getByLabelText('S1 当前视频') as HTMLVideoElement;
 expect(screen.getByText('正在加载视频…')).toBeTruthy();fireEvent.error(video);
 expect(screen.getByRole('alert').textContent).toContain('视频未能加载');
 fireEvent.click(screen.getByRole('button',{name:'重试加载视频'}));
 const next=screen.getByLabelText('S1 当前视频') as HTMLVideoElement;expect(next).not.toBe(video);
 const pause=vi.spyOn(next,'pause').mockImplementation(()=>{});Object.defineProperty(next,'paused',{configurable:true,value:false});
 view.rerender(<WorkspaceShotPreview workspace={workspace} clips={[{...clip,source:{...clip.source!,relativePath:'other.mp4'}}]} project={null} onSelect={vi.fn()}/>);
 expect(pause).toHaveBeenCalled();
});
