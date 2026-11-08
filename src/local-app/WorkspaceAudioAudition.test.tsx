import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {WorkspaceAudioAudition} from './WorkspaceAudioAudition';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('plays the original media from the compact button and keeps the full player available',async()=>{
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(this:HTMLMediaElement){this.dispatchEvent(new Event('play'));return Promise.resolve();});
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){this.dispatchEvent(new Event('pause'));});
 const view=render(<WorkspaceAudioAudition label="候选一" aria-label="候选音频" src="/local.mp3" preload="none"/>);fireEvent.click(screen.getByRole('button',{name:'试听 候选一'}));await waitFor(()=>expect(play).toHaveBeenCalledOnce());expect(screen.getByRole('button',{name:'暂停 候选一'})).toBeTruthy();
 const media=view.container.querySelector('audio')!;expect(media.getAttribute('src')).toBe('/local.mp3');expect(media.closest('[data-media-visibility]')).toBeTruthy();fireEvent.click(screen.getByLabelText('展开 候选一 播放控制'));expect(view.container.querySelector('details')?.open).toBe(true);expect(screen.getByRole('button',{name:'播放速度 1'})).toBeTruthy();
});

it('auditions compact narration without disclosure and releases the original media on unmount',async()=>{
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(this:HTMLMediaElement){this.dispatchEvent(new Event('play'));return Promise.resolve();});
 const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){this.dispatchEvent(new Event('pause'));});
 const view=render(<WorkspaceAudioAudition label="口播候选" showControls={false} src="/original.mp3" preload="none"/>);
 expect(view.container.querySelector('details')).toBeNull();const media=view.container.querySelector('audio')!;expect(media.getAttribute('src')).toBe('/original.mp3');
 fireEvent.click(screen.getByRole('button',{name:'试听 口播候选'}));await waitFor(()=>expect(play).toHaveBeenCalledOnce());
 fireEvent.click(screen.getByRole('button',{name:'暂停 口播候选'}));expect(pause).toHaveBeenCalledOnce();
 fireEvent.ended(media);expect(screen.getByRole('button',{name:'试听 口播候选'})).toBeTruthy();
 view.unmount();expect(media.getAttribute('src')).toBeNull();
});
it('keeps a compact playback failure visible and permits retrying without a hidden player',async()=>{
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockRejectedValueOnce(new Error('media unavailable')).mockResolvedValueOnce();
 render(<WorkspaceAudioAudition label="口播候选" showControls={false} src="/original.mp3" preload="none"/>);
 fireEvent.click(screen.getByRole('button',{name:'试听 口播候选'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','音频暂时无法播放，请再次试听。');
 fireEvent.click(screen.getByRole('button',{name:'试听 口播候选'}));await waitFor(()=>expect(play).toHaveBeenCalledTimes(2));expect(screen.queryByRole('alert')).toBeNull();
});

it('seeks the original audio and updates the bar from media playback',()=>{
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 const view=render(<WorkspaceAudioAudition label="候选二" layout="bar" showControls={false} durationSeconds={2.4} src="/voice.mp3" preload="none"/>);
 const audio=view.container.querySelector('audio')!,range=screen.getByRole('slider',{name:'候选二 播放进度'});
 Object.defineProperties(audio,{readyState:{value:1},duration:{value:2.8}});
 fireEvent.loadedMetadata(audio);expect(range).toHaveProperty('max','2.8');
 fireEvent.change(range,{target:{value:'1.3'}});expect(audio.currentTime).toBe(1.3);
 audio.currentTime=2.1;fireEvent.timeUpdate(audio);expect(range).toHaveProperty('value','2.1');expect(screen.getByText('0:02 / 0:02')).toBeTruthy();
 expect(view.container.querySelector('details')).toBeNull();
});

it('loads before seeking and resets the progress when the source changes',()=>{
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 const load=vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 const props={label:'候选二',layout:'bar' as const,showControls:false,durationSeconds:3,preload:'none' as const};
 const view=render(<WorkspaceAudioAudition {...props} src="/one.mp3"/>),audio=view.container.querySelector('audio')!;
 const range=screen.getByRole('slider',{name:'候选二 播放进度'});fireEvent.change(range,{target:{value:'1.2'}});expect(load).toHaveBeenCalled();
 Object.defineProperty(audio,'duration',{value:3});fireEvent.loadedMetadata(audio);expect(audio.currentTime).toBe(1.2);
 view.rerender(<WorkspaceAudioAudition {...props} src="/two.mp3"/>);expect(range).toHaveProperty('value','0');expect(screen.getByRole('button',{name:'试听 候选二'})).toBeTruthy();
});
