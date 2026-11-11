import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import {WorkspaceDraftOwner} from './WorkspaceDraft';

afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('keeps unfinished shelf files through closing and reopens with the received material instead of importing it twice',async()=>{
 const workspace={id:'shelf-recovery-w',episodeId:'shelf-recovery-e',workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:1,clips:[{id:'clip',itemId:'item',shotId:'S1',text:'镜头'}],project:{relativePath:'project.json',sha256:'sha',fileSize:1,projectId:'project'},readiness:{deliverable:false,placeholders:['item'],missingSources:[]},stale:false};
 let finish!:(value:{id:string;storage_path:string})=>void;
 const imported:string[]=[];
 const command=vi.fn(async(_name:string,value:unknown)=>{const {sourcePath}=value as {sourcePath:string};imported.push(sourcePath);if(sourcePath==='first.png')return new Promise<{id:string;storage_path:string}>(resolve=>{finish=resolve;});return {id:sourcePath,storage_path:'media/'+sourcePath};});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 const view=(ownerId='shelf-owner')=><WorkspaceDraftOwner ownerId={ownerId}><ProductionWorkspacePanel episodeId={workspace.episodeId} title="上传恢复" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/></WorkspaceDraftOwner>;
 const first=render(view());fireEvent.click(await screen.findByRole('button',{name:'本期素材 · 0'}));
 fireEvent.change(screen.getByLabelText('上传制作素材'),{target:{files:[new File(['first'],'first.png',{type:'image/png'}),new File(['second'],'second.png',{type:'image/png'})]}});
 await waitFor(()=>expect(imported).toEqual(['first.png']));first.unmount();
 const other=render(view('another-owner'));await screen.findByRole('button',{name:'本期素材 · 0'});expect(screen.queryByRole('button',{name:'重试未完成项'})).toBeNull();other.unmount();
 render(view());fireEvent.click(await screen.findByRole('button',{name:'本期素材 · 0'}));
 await act(async()=>finish({id:'first.png',storage_path:'media/first.png'}));
 await screen.findByRole('button',{name:'重试未完成项'});expect(screen.getByRole('button',{name:'收起本期素材'}).textContent).toBe('本期素材 · 1');
 fireEvent.click(screen.getByRole('button',{name:'重试未完成项'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'收起本期素材'}).textContent).toBe('本期素材 · 2'));
 expect(imported).toEqual(['first.png','second.png']);expect(screen.queryByRole('button',{name:'重试未完成项'})).toBeNull();
});
