import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MediaRootSettingsDialog} from './MediaRootSettingsDialog';
const manifest={sourceBinding:{path:'/old'},targetBinding:{path:'/new'},accounts:[],episodes:[],fileCount:2,totalBytes:200,space:{freeBytes:1000,reserveBytes:100,requiredBytes:300},canExecute:true,conflicts:[],blockers:[]};
const copying={path:'/old',status:'ready',executing:true,canInitialize:false,migration:{id:'plan',status:'copying',manifest,progress:{copiedFiles:1,copiedBytes:100}}};
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('pauses polling while hidden and immediately reads on return without overlapping reads',async()=>{
 vi.useFakeTimers();let hidden=false,reads=0;
 vi.spyOn(document,'visibilityState','get').mockImplementation(()=>hidden?'hidden':'visible');
 vi.stubGlobal('fetch',vi.fn(async()=>{reads++;return Response.json(copying);}));
 render(<MediaRootSettingsDialog csrf="test" onClose={()=>{}}/>);
 await act(async()=>{});expect(reads).toBe(2);
 hidden=true;act(()=>document.dispatchEvent(new Event('visibilitychange')));
 await act(async()=>vi.advanceTimersByTimeAsync(2000));expect(reads).toBe(2);
 hidden=false;await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(reads).toBe(3);
});
it('a late progress response cannot replace the completed command readback',async()=>{
 let finish!:(response:Response)=>void,progress!:(response:Response)=>void,reads=0;
 vi.stubGlobal('fetch',vi.fn(async(_url,init?:RequestInit)=>{
  if(init?.method==='POST')return new Promise<Response>(resolve=>{finish=resolve;});
  reads++;if(reads===1)return Response.json({...copying,executing:false,migration:{...copying.migration,status:'planned'}});
  if(reads===2)return new Promise<Response>(resolve=>{progress=resolve;});
  return Response.json({...copying,path:'/new',executing:false,migration:{...copying.migration,status:'completed'}});
 }));
 render(<MediaRootSettingsDialog csrf="test" onClose={()=>{}}/>);
 await screen.findByText('/old');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'开始迁移'}));
 await act(async()=>finish(Response.json({status:'completed'})));
 expect(screen.getByText('媒体根迁移完成，服务已使用新位置。')).toBeTruthy();
 await act(async()=>progress(Response.json(copying)));
 expect(screen.queryByRole('progressbar')).toBeNull();expect(screen.getByText('/new')).toBeTruthy();
});
it('guards repeated keyboard submissions synchronously and ignores command completion after closing',async()=>{
 let finish!:(response:Response)=>void,posts=0,reads=0;
 vi.stubGlobal('fetch',vi.fn(async(_url,init?:RequestInit)=>{
  if(init?.method==='POST'){posts++;return new Promise<Response>(resolve=>{finish=resolve;});}
  reads++;return Response.json({...copying,executing:false,migration:null});
 }));
 const view=render(<MediaRootSettingsDialog csrf="test" onClose={()=>{}}/>);
 await screen.findByText('/old');fireEvent.click(screen.getByRole('button',{name:'更换存储位置'}));
 const input=screen.getByRole('textbox',{name:'新位置'});fireEvent.change(input,{target:{value:'/new'}});
 act(()=>{fireEvent.keyDown(input,{key:'Enter'});fireEvent.keyDown(input,{key:'Enter'});});
 expect(posts).toBe(1);view.unmount();await act(async()=>finish(Response.json({id:'plan',status:'planned',manifest})));
 expect(reads).toBe(1);
});
it('finishing a command supersedes a pending manual retry and releases its reading state',async()=>{
 let finish!:(response:Response)=>void,retry!:(response:Response)=>void,reads=0;
 vi.stubGlobal('fetch',vi.fn(async(_url,init?:RequestInit)=>{
  if(init?.method==='POST')return new Promise<Response>(resolve=>{finish=resolve;});
  reads++;if(reads===1)return Response.json({...copying,executing:false,migration:{...copying.migration,status:'planned'}});
  if(reads===2)throw Error('暂时断开');
  if(reads===3)return new Promise<Response>(resolve=>{retry=resolve;});
  return Response.json({...copying,path:'/new',executing:false,migration:{...copying.migration,status:'completed'}});
 }));
 render(<MediaRootSettingsDialog csrf="test" onClose={()=>{}}/>);await screen.findByText('/old');
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'开始迁移'}));
 await screen.findByText('暂时断开');fireEvent.click(screen.getByRole('button',{name:'重新读取存储位置'}));
 await act(async()=>finish(Response.json({status:'completed'})));
 expect((screen.getByRole('button',{name:'更换存储位置'}) as HTMLButtonElement).disabled).toBe(false);
 await act(async()=>retry(Response.json(copying)));expect(screen.queryByRole('progressbar')).toBeNull();
});
