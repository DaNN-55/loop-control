import {createRef} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AudioPreview} from './AudioPreview';
beforeEach(()=>{
 vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{value:false,configurable:true});this.dispatchEvent(new Event('play'));return Promise.resolve();});
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{value:true,configurable:true});this.dispatchEvent(new Event('pause'));});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('uses the real AudioSkin controls to play and pause the original audio source',async()=>{
 const {container}=render(<AudioPreview src="/registered.mp3?sha256=original" aria-label="口播试听" preload="none"/>);
 const audio=screen.getByLabelText('口播试听') as HTMLAudioElement;
 expect(container.querySelector('.audio-skin')).toBeTruthy();expect(audio.controls).toBe(false);expect(audio.preload).toBe('none');expect(audio.src).toContain('/registered.mp3?sha256=original');
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'播放'}));});expect(audio.play).toHaveBeenCalled();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'暂停'}));});expect(audio.pause).toHaveBeenCalled();
});
it('stops the old source on replacement and exposes the current native media ref',async()=>{
 const ref=createRef<HTMLAudioElement>();const {rerender,unmount}=render(<AudioPreview ref={ref} src="/one.wav" aria-label="试听"/>);const first=ref.current!;
 await act(async()=>{await first.play();});rerender(<AudioPreview ref={ref} src="/two.wav" aria-label="试听"/>);
 expect(first.paused).toBe(true);expect(ref.current).not.toBe(first);expect(ref.current?.src).toContain('/two.wav');
 const current=ref.current!;await act(async()=>{await current.play();});unmount();expect(current.paused).toBe(true);
});
it('reports a rejected voice-sample playback without issuing a generation request',async()=>{
 vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('playback denied'));
 const error=vi.fn();render(<AudioPreview src="blob:voice-sample" autoPlay onPlaybackError={error} aria-label="声音试听"/>);
 await waitFor(()=>expect(error).toHaveBeenCalledWith('playback denied'));
});
it('ignores a playback rejection from an intentionally replaced sample',async()=>{
 let reject!:(reason:Error)=>void;
 vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(()=>new Promise<void>((_resolve,rejectPlay)=>{reject=rejectPlay;}));
 const error=vi.fn(),view=render(<AudioPreview src="blob:old" autoPlay onPlaybackError={error}/>);
 view.rerender(<AudioPreview src="blob:new" onPlaybackError={error}/>);
 await act(async()=>{reject(new Error('interrupted'));});expect(error).not.toHaveBeenCalled();
});
it('音频加载失败可原位重试，页面隐藏会暂停试听',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 render(<AudioPreview src="/registered.mp3" aria-label="错误试听"/>);
 const audio=screen.getByLabelText('错误试听') as HTMLAudioElement;
 fireEvent.loadStart(audio);expect(screen.getByText('正在加载音频…')).toBeTruthy();
 fireEvent.error(audio);expect(screen.getByRole('alert').textContent).toContain('音频未能加载');
 fireEvent.click(screen.getByRole('button',{name:'重试加载音频'}));
 const next=screen.getByLabelText('错误试听') as HTMLAudioElement;expect(next).not.toBe(audio);
 await act(async()=>{await next.play();});Object.defineProperty(document,'hidden',{configurable:true,value:true});fireEvent(document,new Event('visibilitychange'));expect(next.paused).toBe(true);Object.defineProperty(document,'hidden',{configurable:true,value:false});
});
it('retains the current audio source through StrictMode setup and releases it on unmount',async()=>{
 const {StrictMode}=await import('react');const {rerender,unmount}=render(<StrictMode><AudioPreview src="/strict-first.mp3" aria-label="严格模式音频"/></StrictMode>);const first=screen.getByLabelText('严格模式音频') as HTMLAudioElement;
 expect(first.getAttribute('src')).toBe('/strict-first.mp3');rerender(<StrictMode><AudioPreview src="/strict-second.mp3" aria-label="严格模式音频"/></StrictMode>);const second=screen.getByLabelText('严格模式音频') as HTMLAudioElement;expect(second.getAttribute('src')).toBe('/strict-second.mp3');unmount();expect(second.getAttribute('src')).toBeNull();
});
