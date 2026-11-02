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
