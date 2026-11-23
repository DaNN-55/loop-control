import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {CompletedCatalogArtwork} from './CompletedCatalogArtwork';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const video={relativePath:'current.mp4',sha256:'video',fileSize:100};
const cover={file:{relativePath:'delivery.png',sha256:'cover',fileSize:10}};

it('prefers the publication cover and falls back to a static first frame, then to a placeholder',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({cover})));
 const {container}=render(<CompletedCatalogArtwork episodeId="e" video={video}/>);
 const image=await screen.findByRole('img',{name:'交付封面'});
 expect(image.getAttribute('src')).toContain('path=delivery.png');

 const media=container.querySelector('video')!;
 expect(media.hidden).toBe(true);
 fireEvent.error(image);
 expect(media.preload).toBe('auto');
 fireEvent.loadedData(media);
 expect(media.hidden).toBe(false);
 expect(media.controls||media.autoplay).toBe(false);
 expect(screen.getByRole('group',{name:'成片首帧'})).toBeTruthy();

 fireEvent.error(media);
 expect(screen.getByText('预览暂不可用')).toBeTruthy();
});

it('shows a first frame when no cover was saved',async()=>{
 const read=vi.fn(async()=>Response.json({cover:null}));
 vi.stubGlobal('fetch',read);
 const {container}=render(<CompletedCatalogArtwork episodeId="e" video={video}/>);
 const media=container.querySelector('video')!;
 await waitFor(()=>expect(media.preload).toBe('auto'));
 fireEvent.loadedData(media);
 expect(screen.getByRole('group',{name:'成片首帧'})).toBeTruthy();
});

it('sizes the carousel from the video, with the cover dimensions available first',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({cover})));
 const {container}=render(<CompletedCatalogArtwork episodeId="e" video={video}/>);
 const image=await screen.findByRole('img',{name:'交付封面'});
 const artwork=container.querySelector<HTMLElement>('.production-completed-artwork')!;
 Object.defineProperties(image,{naturalWidth:{value:1080},naturalHeight:{value:1920}});
 fireEvent.load(image);
 expect(artwork.style.getPropertyValue('--completed-media-ratio')).toBe('0.5625');

 const media=container.querySelector('video')!;
 Object.defineProperties(media,{videoWidth:{value:1920},videoHeight:{value:1080}});
 fireEvent.loadedMetadata(media);
 expect(artwork.style.getPropertyValue('--completed-media-ratio')).toBe(String(16/9));
});

it('uses the side arrows to navigate between the two slides',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({cover:null})));
 const {container}=render(<CompletedCatalogArtwork episodeId="e" video={video}/>);
 const track=container.querySelector<HTMLElement>('.production-completed-track')!;
 await waitFor(()=>expect(track.querySelector('video')?.preload).toBe('auto'));
 vi.spyOn(track.querySelector('.production-completed-playback video') as HTMLVideoElement,'pause').mockImplementation(()=>{});
 const previous=screen.getByRole('button',{name:'查看封面'});
 const next=screen.getByRole('button',{name:'查看视频'});
 Object.defineProperties(track,{
  clientWidth:{value:200},
  scrollTo:{value:vi.fn(({left}:{left:number})=>{track.scrollLeft=left;fireEvent.scroll(track);})},
 });
 expect(previous.getAttribute('aria-disabled')).toBe('true');
 fireEvent.click(next);
 await waitFor(()=>expect(next.getAttribute('aria-disabled')).toBe('true'));
 expect(track.scrollLeft).toBe(200);
 expect(screen.getByRole('status').textContent).toBe('成片');
 fireEvent.click(previous);
 await waitFor(()=>expect(previous.getAttribute('aria-disabled')).toBe('true'));
 expect(track.scrollLeft).toBe(0);
});
