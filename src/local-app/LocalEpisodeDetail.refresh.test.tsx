import {StrictMode} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('./ProductionWorkspacePanel',()=>({ProductionWorkspacePanel:({title,episodeId,command}:{title:string;episodeId:string;command:(name:string,data:unknown)=>Promise<unknown>})=><section><h1>{title}</h1><button onClick={()=>void command('saveWorkspaceNarration',{episodeId}).catch(()=>{})}>保存口播</button></section>}));
import {LocalEpisodeDetail} from './LocalEpisodeDetail';
beforeEach(()=>{vi.resetModules();sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
const snapshot=(id:string)=>({episode:{id,account_id:'account',title:id,stage:'waiting_input',archived_at:null,main_script_revision_id:null},reviewPackages:[],tasks:[]});

it('opens the order without fetching or displaying business quality',async()=>{
 const request=vi.fn(async(path:string)=>Response.json(path.endsWith('/session')?{csrfToken:'fixture-csrf',productionMetricsEnabled:true}:{hashes:{},sections:snapshot('without-quality')}));
 vi.stubGlobal('fetch',request);
 render(<LocalEpisodeDetail {...{productionMetricsEnabled:true}} episodeId="without-quality" onClose={()=>{}} onChanged={async()=>{}}/>);
 await screen.findByRole('heading',{name:'without-quality'});
 expect(screen.queryByRole('combobox',{name:'业务质量档'})).toBeNull();
 expect(request.mock.calls.every(([path])=>!path.includes('production-quality'))).toBe(true);
});

it('does not let a completed command background read replace the next episode or Owner access',async()=>{
 let writes=0,releaseEpisode!:(value:Response)=>void,rejectCatalog!:(reason:Error)=>void;
 const oldEpisode=new Promise<Response>(resolve=>{releaseEpisode=resolve;}),oldCatalog=new Promise<void>((_,reject)=>{rejectCatalog=reject;});
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture-csrf'});
  if(init?.method==='POST'){writes++;return Response.json({saved:true});}
  const id=path.match(/episodes\/([^?]+)/)?.[1];
  if(id==='old'&&writes)return oldEpisode;
  return Response.json({hashes:{},sections:snapshot(id!)});
 }));
 const view=render(<LocalEpisodeDetail episodeId="old" ownerId="first" onClose={()=>{}} onChanged={()=>oldCatalog}/>);
 fireEvent.click(await screen.findByRole('button',{name:'保存口播'}));
 await waitFor(()=>expect(writes).toBe(1));
 view.rerender(<LocalEpisodeDetail episodeId="new" ownerId="second" onClose={()=>{}} onChanged={async()=>{}}/>);
 await screen.findByRole('heading',{name:'new'});
 await act(async()=>{releaseEpisode(Response.json({hashes:{},sections:snapshot('old')}));rejectCatalog(Error('old catalog failed'));});
 expect(screen.getByRole('heading',{name:'new'})).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
});

it('reports an independent read failure without waiting for another read, and drops an older write refresh error',async()=>{
 let writes=0,rejectFirst!:(reason:Error)=>void;
 const first=new Promise<void>((_,reject)=>{rejectFirst=reject;});
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture-csrf'});
  if(init?.method==='POST'){writes++;return Response.json({saved:true});}
  return Response.json({hashes:{},sections:snapshot('current')});
 }));
 const changed=vi.fn(()=>writes===1?first:Promise.resolve());
 render(<LocalEpisodeDetail episodeId="current" onClose={()=>{}} onChanged={changed}/>);
 const save=await screen.findByRole('button',{name:'保存口播'});fireEvent.click(save);await waitFor(()=>expect(writes).toBe(1));
 fireEvent.click(save);await waitFor(()=>expect(writes).toBe(2));await act(async()=>{rejectFirst(Error('old refresh failed'));});
 expect(screen.queryByRole('alert')).toBeNull();
});

it('does not publish an older successful snapshot after a newer command and refresh have completed',async()=>{
 let writes=0,reads=0,releaseOld!:(value:Response)=>void;
 const old=new Promise<Response>(resolve=>{releaseOld=resolve;});
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture-csrf'});
  if(init?.method==='POST'){writes++;return Response.json({saved:true});}
  reads++;
  if(writes===1)return old;
  return Response.json({hashes:{},sections:snapshot(writes?'after-second':'current')});
 }));
 render(<LocalEpisodeDetail episodeId="current" onClose={()=>{}} onChanged={async()=>{}}/>);
 const save=await screen.findByRole('button',{name:'保存口播'});fireEvent.click(save);await waitFor(()=>expect(writes).toBe(1));
 fireEvent.click(save);await waitFor(()=>expect(writes).toBe(2));await screen.findByRole('heading',{name:'after-second'});
 await act(async()=>{releaseOld(Response.json({hashes:{},sections:snapshot('after-first')}));});
 expect(screen.getByRole('heading',{name:'after-second'})).toBeTruthy();expect(reads).toBe(3);
});

it('does not report a superseded polling abort as a failure of a newer successful command',async()=>{
 let reads=0,signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture-csrf'});
  if(init?.method==='POST')return Response.json({saved:true});
  if(++reads===2){signal=init?.signal??undefined;return new Promise<Response>((_,reject)=>signal?.addEventListener('abort',()=>reject(signal!.reason),{once:true}));}
  return Response.json({hashes:{},sections:snapshot(reads===1?'current':'saved')});
 }));
 render(<LocalEpisodeDetail episodeId="current" onClose={()=>{}} onChanged={async()=>{}}/>);
 const save=await screen.findByRole('button',{name:'保存口播'});
 await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
 await waitFor(()=>expect(reads).toBe(2));
 fireEvent.click(save);await screen.findByRole('heading',{name:'saved'});
 expect(signal?.aborted).toBe(true);expect(screen.queryByRole('alert')).toBeNull();
});


it('loads successfully through the StrictMode effect cleanup without retaining a cancelled initial poll error',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture-csrf'});
  return Response.json({hashes:{},sections:snapshot('strict-current')});
 }));
 render(<StrictMode><LocalEpisodeDetail episodeId="strict-current" onClose={()=>{}} onChanged={async()=>{}}/></StrictMode>);
 await screen.findByRole('heading',{name:'strict-current'});
 expect(screen.queryByRole('alert')).toBeNull();
});
