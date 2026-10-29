import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkbenchArtwork,useWorkbenchPreview} from './workbenchPreview';
import type {EpisodeProductionSnapshot} from '../episodes/EpisodeProductionContainer';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const artifact=(id:string,type:string,path:string)=>({id,artifact_type:type,relative_path:path,sha256:id.repeat(64),created_at:'2026-10-28T00:00:00Z'}) as EpisodeProductionSnapshot['artifacts'][number];
it('aborts the previous selected episode read and never replaces the new preview with an old response',async()=>{
 const reads:Array<{resolve:(value:Response)=>void;signal:AbortSignal}>=[];
 vi.stubGlobal('fetch',vi.fn((_path:string,init:RequestInit)=>new Promise<Response>(resolve=>reads.push({resolve,signal:init.signal as AbortSignal}))));
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
