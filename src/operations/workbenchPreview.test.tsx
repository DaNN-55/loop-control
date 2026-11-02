import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {WorkbenchArtwork,useWorkbenchPreview} from './workbenchPreview';
import type {EpisodeProductionSnapshot} from '../episodes/EpisodeProductionContainer';
beforeEach(()=>{vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
const artifact=(id:string,type:string,path:string)=>({id,artifact_type:type,relative_path:path,sha256:id.repeat(64),created_at:'2026-10-28T00:00:00Z'}) as EpisodeProductionSnapshot['artifacts'][number];
it('aborts the previous selected episode read and never replaces the new preview with an old response',async()=>{
 const reads:Array<{resolve:(value:Response)=>void;signal:AbortSignal}>=[];
 vi.stubGlobal('fetch',vi.fn((_path:string,init:RequestInit)=>_path.endsWith('/workspace')?Promise.resolve(Response.json({workspace:null})):new Promise<Response>(resolve=>reads.push({resolve,signal:init.signal as AbortSignal}))));
 function Probe({id}:{id:string}){const p=useWorkbenchPreview(id,'v1',true);return <output>{p.data?.artifacts?.[0]?.id??'读取中'}</output>;}
 const {rerender}=render(<Probe id="episode-a"/>);rerender(<Probe id="episode-b"/>);expect(reads[0].signal.aborted).toBe(true);
 reads[1].resolve(Response.json({sections:{artifacts:[artifact('b','cover','cover-b.png')]}}));await screen.findByText('b');
 reads[0].resolve(Response.json({sections:{artifacts:[artifact('a','cover','cover-a.png')]}}));await waitFor(()=>expect(screen.getByText('b')).toBeTruthy());expect(screen.queryByText('a')).toBeNull();
});
it('prefers the registered cover with its SHA and falls back explicitly when media fails',()=>{
 render(<WorkbenchArtwork episodeId="episode-a" title="真实作品" artifacts={[artifact('v','render','render.mp4'),artifact('c','cover','cover.png')]}/>);
 const image=screen.getByRole('img',{name:'真实作品作品预览'});const source=new URL(image.getAttribute('src')!,'http://localhost');expect(source.searchParams.get('sha256')).toBe('c'.repeat(64));expect(source.searchParams.get('path')).toBe('cover.png');
 fireEvent.error(image);expect(screen.getByText('预览暂不可用')).toBeTruthy();
});

it('starts on the cover, switches to a playable final video, and stops it when returning',()=>{
 render(<WorkbenchArtwork episodeId="episode-a" title="作品" artifacts={[artifact('c','cover','cover.png'),artifact('f','final_render','final.mp4'),{...artifact('r','review_render','review.mp4'),created_at:'2026-10-29T00:00:00Z'}]}/>);
 expect(screen.getByRole('img')).toBeTruthy();expect((screen.getByRole('button',{name:'查看封面'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByLabelText('作品视频预览')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'查看视频'}));
 const video=screen.getByLabelText('作品视频预览') as HTMLVideoElement;
 expect(new URL(video.src).searchParams.get('path')).toBe('final.mp4');expect(video.controls).toBe(false);expect(screen.getByRole('button',{name:'播放视频'})).toBeTruthy();expect(video.autoplay).toBe(false);expect(video.muted).toBe(false);expect(video.getAttribute('preload')).toBe('metadata');expect((screen.getByRole('button',{name:'查看视频'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'查看封面'}));expect(screen.getByRole('img')).toBeTruthy();expect(screen.queryByLabelText('作品视频预览')).toBeNull();expect(video.pause).toHaveBeenCalledOnce();
});
it('resets to the cover and stops playback when the selected production order changes',()=>{
 const assets=[artifact('c','cover','cover.png'),artifact('v','render','render.mp4')];
 const {rerender}=render(<WorkbenchArtwork episodeId="episode-a" title="作品甲" artifacts={assets}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看视频'}));const video=screen.getByLabelText('作品甲视频预览') as HTMLVideoElement;
 rerender(<WorkbenchArtwork episodeId="episode-b" title="作品乙" artifacts={assets}/>);
 expect(screen.queryByLabelText('作品乙视频预览')).toBeNull();expect(new URL(screen.getByRole('img').getAttribute('src')!,'http://localhost').searchParams.get('episode')).toBe('episode-b');expect(video.pause).toHaveBeenCalledOnce();
});
it('uses the registered video thumbnail as the initial cover when no cover exists',()=>{
 render(<WorkbenchArtwork episodeId="episode-a" title="作品" artifacts={[artifact('f','final_render','final.mp4')]}/>);
 const source=new URL(screen.getByRole('img').getAttribute('src')!,'http://localhost');expect(source.searchParams.get('thumbnail')).toBe('keyframe');expect(source.searchParams.get('sha256')).toBe('f'.repeat(64));
 fireEvent.click(screen.getByRole('button',{name:'查看视频'}));expect((screen.getByLabelText('作品视频预览') as HTMLVideoElement).controls).toBe(false);expect(screen.getByRole('slider',{name:'视频进度'})).toBeTruthy();
});
it('keeps the cover reachable after a video fails and the video reachable after a cover fails',()=>{
 render(<WorkbenchArtwork episodeId="episode-a" title="作品" artifacts={[artifact('c','cover','cover.png'),artifact('f','final_render','final.mp4')]}/>);
 fireEvent.error(screen.getByRole('img'));expect(screen.getByText('预览暂不可用')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'查看视频'}));const video=screen.getByLabelText('作品视频预览');expect(video).toBeTruthy();fireEvent.error(video);expect(screen.getByText('预览暂不可用')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'查看封面'}));expect(screen.getByText('预览暂不可用')).toBeTruthy();expect((screen.getByRole('button',{name:'查看视频'}) as HTMLButtonElement).disabled).toBe(false);
});
it('omits navigation when there is only a cover or no media',()=>{
 const {rerender}=render(<WorkbenchArtwork episodeId="episode-a" title="作品" artifacts={[artifact('c','cover','cover.png')]}/>);
 expect(screen.getByRole('img')).toBeTruthy();expect(screen.queryByRole('group',{name:'作品预览切换'})).toBeNull();
 rerender(<WorkbenchArtwork episodeId="episode-b" title="作品"/>);expect(screen.getByText('尚未生成封面')).toBeTruthy();expect(screen.queryByRole('group',{name:'作品预览切换'})).toBeNull();
});

it('reads the existing workspace export even when it is not listed among public artifacts',async()=>{
 const exported={relativePath:'workspace-exports/final.mp4',sha256:'a'.repeat(64),fileSize:123};
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.endsWith('/workspace')?{workspace:{exports:[{status:'failed',artifact:{...exported,relativePath:'failed.mp4'},checks:[]},{status:'ready',artifact:exported,checks:[{passed:true}]}]}}:{sections:{artifacts:[artifact('c','cover','cover.png')]}})));
 function Preview(){const result=useWorkbenchPreview('episode-a','v1',true);return <WorkbenchArtwork episodeId="episode-a" title="作品" {...result.data}/>;}
 render(<Preview/>);await screen.findByRole('button',{name:'查看视频'});fireEvent.click(screen.getByRole('button',{name:'查看视频'}));
 expect(new URL((screen.getByLabelText('作品视频预览') as HTMLVideoElement).src).searchParams.get('path')).toBe(exported.relativePath);
});
it('keeps the cover when the optional workspace read fails',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/workspace'))throw Error('workspace unavailable');return Response.json({sections:{artifacts:[artifact('c','cover','cover.png')]}});}));
 function Preview(){const result=useWorkbenchPreview('episode-a','v1',true);return <WorkbenchArtwork episodeId="episode-a" title="作品" {...result.data}/>;}
 render(<Preview/>);await screen.findByRole('img');expect(screen.queryByRole('button',{name:'查看视频'})).toBeNull();
});
