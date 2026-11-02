import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspacePexelsSearch} from './WorkspacePexelsSearch';
import {useWorkspaceReading} from './useWorkspaceReading';
import type {ProductionWorkspace} from '../productionWorkspace';

const selection={capability:'video',provider:'pexels',adapter:'pexels_video',connectionVersionId:'version'};
const source={id:11,fileId:12,durationSeconds:4,width:640,height:360,creator:'Fixture creator',creatorUrl:'https://www.pexels.com/@fixture/',sourceUrl:'https://www.pexels.com/video/11/',downloadUrl:'https://videos.pexels.com/video-files/11/test.mp4',thumbnailUrl:'https://images.pexels.com/videos/11/preview.jpg'};
const search={id:'search',taskId:'task',targetItemId:'visual-1',operation:'search',query:'ocean',parameters:{orientation:'landscape',size:'medium',page:1},selection,connectionName:'Pexels A',status:'completed',error:null,results:[source,{...source,id:22,thumbnailUrl:undefined}]};
const workspace={id:'workspace',episodeId:'episode',revision:3,pexels:{requests:[search]}} as unknown as ProductionWorkspace;
const catalog={serviceCatalog:{groups:[{capability:'video',services:[{id:'service',connectionVersionId:'version',provider:'pexels',adapter:'pexels_video',mode:'search',label:'Pexels A',executable:true}]}]}};
function Host({initial=workspace,command=async()=>workspace}:{initial?:ProductionWorkspace;command?:(name:string,data:unknown)=>Promise<unknown>}){
 const [w,set]=useState(initial),reader=useWorkspaceReading(w,set,'visual-1','无法读取 Pexels 结果。');
 return <WorkspacePexelsSearch workspace={w} targetItemId="visual-1" command={command} onChange={set} prepare={async()=>w} reader={reader}/>;
}
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();vi.useRealTimers();});
it('shows thumbnails before downloading with separate loading, missing and failed-image states',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(catalog)));const command=vi.fn();render(<Host command={command}/>);
 await act(async()=>{});const image=screen.getByAltText('Pexels 11 缩略图');expect(image.getAttribute('src')).toBe(source.thumbnailUrl);
 expect(screen.getByText('缩略图加载中…')).toBeTruthy();expect(screen.getByText('暂无缩略图')).toBeTruthy();
 fireEvent.load(image);expect(screen.queryByText('缩略图加载中…')).toBeNull();
 fireEvent.error(image);expect(screen.getByText('缩略图加载失败')).toBeTruthy();expect(screen.queryByAltText('Pexels 11 缩略图')).toBeNull();
 expect(screen.getByRole('button',{name:'下载预览 #11'})).toBeTruthy();expect(command).not.toHaveBeenCalled();
});

it('retries connection loading locally without changing the query, target or current results',async()=>{
 sessionStorage.setItem('loop-pexels-draft:workspace:visual-1',JSON.stringify({query:'保留查询',orientation:'landscape',size:'small',page:'2',selection}));
 let attempts=0;vi.stubGlobal('fetch',vi.fn(async()=>++attempts===1?new Response('',{status:503}):Response.json(catalog)));const command=vi.fn();render(<Host command={command}/>);
 const retry=await screen.findByRole('button',{name:'重试读取连接'});expect((screen.getByLabelText('检索词') as HTMLInputElement).value).toBe('保留查询');expect(screen.getByAltText('Pexels 11 缩略图')).toBeTruthy();
 fireEvent.click(retry);await waitFor(()=>expect(screen.queryByRole('button',{name:'重试读取连接'})).toBeNull());
 expect((screen.getByLabelText('检索词') as HTMLInputElement).value).toBe('保留查询');expect((screen.getByLabelText('Pexels 连接') as HTMLSelectElement).value).toBe('service');expect((screen.getByLabelText('Pexels 页码') as HTMLInputElement).value).toBe('2');expect(screen.getByAltText('Pexels 11 缩略图')).toBeTruthy();
 expect(command).not.toHaveBeenCalled();expect(attempts).toBe(2);
});

it('keeps visible results after a polling read fails and retries the workspace without issuing a new search',async()=>{
 vi.useFakeTimers();let reads=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/local/connections'?Response.json(catalog):++reads===1?new Response('',{status:503}):Response.json({workspace})));
 const pending={...workspace,pexels:{requests:[search,{...search,id:'preview',taskId:'preview-task',operation:'preview',status:'running',source:{...source,searchId:'search'},results:undefined}]}} as unknown as ProductionWorkspace;
 const command=vi.fn();render(<Host initial={pending} command={command}/>);fireEvent.change(screen.getByLabelText('检索词'),{target:{value:'未提交的新查询'}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});
 expect(screen.getByText('无法读取 Pexels 结果。')).toBeTruthy();expect(screen.getByAltText('Pexels 11 缩略图')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'重试读取结果'}));await act(async()=>{});
 expect(screen.queryByRole('button',{name:'重试读取结果'})).toBeNull();expect((screen.getByLabelText('检索词') as HTMLInputElement).value).toBe('未提交的新查询');expect(screen.getByAltText('Pexels 11 缩略图')).toBeTruthy();expect(command).not.toHaveBeenCalled();expect(reads).toBe(2);
});

it('downloads and imports only on separate presses and prevents repeated in-flight submissions',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(catalog)));
 let finish!:(value:ProductionWorkspace)=>void;
 const command=vi.fn((_name:string,_data:unknown)=>new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}));render(<Host command={command}/>);await act(async()=>{});
 const download=screen.getByRole('button',{name:'下载预览 #11'});fireEvent.click(download);fireEvent.click(download);await act(async()=>{});
 expect(command).toHaveBeenCalledTimes(1);expect(command).toHaveBeenLastCalledWith('previewWorkspacePexelsVideo',expect.objectContaining({searchId:'search',resultId:11}));expect(screen.queryByRole('button',{name:'导入为画面候选'})).toBeNull();
 const preview={...search,id:'preview',operation:'preview',source:{...source,searchId:'search'},preview:{relativePath:'episodes/episode/preview.mp4',sha256:'a'.repeat(64),fileSize:100},results:undefined};
 await act(async()=>finish({...workspace,pexels:{requests:[preview,search]}} as unknown as ProductionWorkspace));
 expect(screen.queryByAltText('Pexels 11 缩略图')).toBeNull();const importButton=screen.getByRole('button',{name:'导入为画面候选'});fireEvent.click(importButton);fireEvent.click(importButton);await act(async()=>{});
 expect(command).toHaveBeenCalledTimes(2);expect(command).toHaveBeenLastCalledWith('importWorkspacePexelsVideo',expect.objectContaining({previewId:'preview'}));
 await act(async()=>finish({...workspace,pexels:{requests:[{...preview,candidateId:'candidate'},search]}} as unknown as ProductionWorkspace));
 expect((screen.getByRole('button',{name:'已导入候选'}) as HTMLButtonElement).disabled).toBe(true);expect(command.mock.calls.map(call=>call[0])).toEqual(['previewWorkspacePexelsVideo','importWorkspacePexelsVideo']);
});
