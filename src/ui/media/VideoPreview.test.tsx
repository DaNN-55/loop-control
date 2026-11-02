import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {VideoPreview} from './VideoPreview';
beforeEach(()=>{
 vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{value:false,configurable:true});this.dispatchEvent(new Event('play'));return Promise.resolve();});
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{value:true,configurable:true});this.dispatchEvent(new Event('pause'));});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();Object.defineProperty(document,'hidden',{value:false,configurable:true});});
it('同一套真实播放控件支持按钮和聚焦后的Space/M/左右键，不跨出片段边界',async()=>{
 render(<VideoPreview src="/source.mp4" title="片段" segment={{start:2,end:5}}/>);
 const video=screen.getByLabelText('片段视频预览') as HTMLVideoElement,player=screen.getByLabelText('片段播放器');
 Object.defineProperty(video,'duration',{value:20,configurable:true});Object.defineProperty(video,'readyState',{value:1,configurable:true});Object.defineProperty(video,'seekable',{value:{length:1,start:()=>0,end:()=>20},configurable:true});fireEvent.loadedMetadata(video);fireEvent.durationChange(video);fireEvent.progress(video);fireEvent.timeUpdate(video);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'播放视频'}));});expect(video.paused).toBe(false);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'暂停视频'}));});expect(video.paused).toBe(true);
 player.focus();await act(async()=>{fireEvent.keyDown(player,{key:' ',code:'Space'});fireEvent.keyUp(player,{key:' ',code:'Space'});});expect(video.paused).toBe(false);
 await act(async()=>{fireEvent.keyDown(player,{key:'m',code:'KeyM'});fireEvent.keyUp(player,{key:'m',code:'KeyM'});});expect(video.muted).toBe(true);
 await act(async()=>{fireEvent.keyDown(player,{key:'ArrowRight',code:'ArrowRight'});});fireEvent.seeking(video);fireEvent.timeUpdate(video);expect(video.currentTime).toBe(5);
 await act(async()=>{fireEvent.keyDown(player,{key:'ArrowLeft',code:'ArrowLeft'});});fireEvent.seeking(video);expect(video.currentTime).toBe(2);
 Object.defineProperty(document,'hidden',{value:true,configurable:true});fireEvent(document,new Event('visibilitychange'));expect(video.paused).toBe(true);
});
it('retains the current video source through StrictMode setup and still releases replaced and unmounted media',async()=>{
 const {StrictMode}=await import('react');const {rerender,unmount}=render(<StrictMode><VideoPreview src="/strict-first.mp4" title="严格模式"/></StrictMode>);const first=screen.getByLabelText('严格模式视频预览') as HTMLVideoElement;
 expect(first.getAttribute('src')).toBe('/strict-first.mp4');rerender(<StrictMode><VideoPreview src="/strict-second.mp4" title="严格模式"/></StrictMode>);const second=screen.getByLabelText('严格模式视频预览') as HTMLVideoElement;expect(first.getAttribute('src')).toBeNull();expect(second.getAttribute('src')).toBe('/strict-second.mp4');unmount();expect(second.getAttribute('src')).toBeNull();
});
