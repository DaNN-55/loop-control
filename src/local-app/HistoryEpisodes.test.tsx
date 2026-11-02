import{act,cleanup,fireEvent,render,screen,waitFor,within}from'@testing-library/react';import{afterEach,beforeEach,expect,it,vi}from'vitest';import{LocalHistory}from'./LocalHistory';import{localRequest,localCommand}from'./client';vi.mock('./client',()=>({localRequest:vi.fn(),localCommand:vi.fn()}));
const episode={episode_id:'10000000-0000-4000-8000-000000000001',title:'日照金山样片',account_name:'样片账号',updated_at:'now',file_count:1,record_count:2,archived_at:null};
const report={items:[episode],total:1,page:1,pageSize:30,selected:null as typeof episode|null,files:[{logical_path:'episodes/'+episode.episode_id+'/script.md',sha256:'a'.repeat(64),bytes:'123',title:'说明文档 · script.md',section:'script'}],versions:[],pagination:{filesPage:1,recordsPage:1,fileTotal:1,recordTotal:2}};
beforeEach(()=>{Element.prototype.scrollIntoView=vi.fn();vi.mocked(localRequest).mockImplementation(async(path)=>({...report,selected:new URL(path,'http://local/').searchParams.get('episode')?episode:null}));});afterEach(()=>{cleanup();vi.resetAllMocks();});
it('starts with production history and keeps sources behind a lazy main tab',async()=>{
 render(<LocalHistory/>);await screen.findByText('日照金山样片');expect(screen.queryByText(/测试与诊断/)).toBeNull();expect(screen.queryByRole('button',{name:'刷新资料'})).toBeNull();expect(screen.getByRole('tab',{name:'生产单历史'}).getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('tab',{name:'资料来源'}).getAttribute('aria-selected')).toBe('false');expect(screen.queryByRole('region',{name:'资料来源管理'})).toBeNull();
 const title=screen.getByText('日照金山样片').closest('.history-episode-row')!;expect(within(title as HTMLElement).getByRole('button',{name:'清理预览 日照金山样片'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'查看内容 日照金山样片'}));await screen.findByRole('region',{name:'生产单历史内容'});expect(document.querySelector('.history-episode-content > details')?.textContent).toContain('技术记录与版本快照');const script=screen.getByText('脚本（本页 1 项）').closest('details')!;expect(script.open).toBe(false);fireEvent.click(screen.getByText('脚本（本页 1 项）'));expect(screen.getByRole('link',{name:/episodes/}).getAttribute('href')).toContain('/api/local/history-file?sha=');
});
it('archives only the historical entry and offers a preview without delete execution',async()=>{
 vi.mocked(localCommand).mockResolvedValueOnce({archived:true}).mockResolvedValueOnce({episodeId:episode.episode_id,recordLinks:2,fileLinks:1,sharedContents:1,protectedContents:0,reviewContents:0,reviewBytes:0,samples:[]});render(<LocalHistory/>);await screen.findByText(episode.title);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'归档历史 '+episode.title})));expect(localCommand).toHaveBeenCalledWith('archive',{episodeId:episode.episode_id},undefined,'history-episode-management');expect(screen.getByText(/生产单和文件不变/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'关闭历史提示'}));expect(screen.queryByText(/生产单和文件不变/)).toBeNull();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'清理预览 '+episode.title})));const dialog=screen.getByRole('dialog',{name:episode.title+' · 清理预览'});const preview=within(dialog).getByRole('region',{name:'生产单清理预览'});expect(document.querySelector('.reference-history-panel .history-cleanup-preview')).toBeNull();expect(preview.textContent).toContain('以下为留存核查结果；永久删除前需确认完整范围。');expect(within(preview).getByRole('button',{name:'永久删除…'})).toBeTruthy();expect(within(preview).queryByRole('button',{name:'永久删除'})).toBeNull();fireEvent.click(within(dialog).getByRole('button',{name:'关闭清理预览'}));expect(screen.queryByRole('dialog')).toBeNull();await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'清理预览 '+episode.title})));expect(vi.mocked(localCommand).mock.calls.map(call=>call[0])).toEqual(['archive','preview']);
});

it('replaces preview counts with the focused deletion confirmation and can return without deleting',async()=>{
 vi.mocked(localCommand).mockResolvedValueOnce({recordLinks:2,fileLinks:1,sharedContents:0,protectedContents:0,reviewContents:1,reviewBytes:1,samples:[]}).mockResolvedValueOnce({episodeId:episode.episode_id,title:episode.title,confirmation:episode.title,revision:'fixture',liveEpisode:true,path:'/fixture',paths:['/fixture'],recordCount:2,fileLinks:1,historyFiles:1,historyBytes:1,historyPaths:['/fixture/history'],preservedFiles:0});
 render(<LocalHistory/>);await screen.findByText(episode.title);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'清理预览 '+episode.title})));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'永久删除…'})));
 const dialog=screen.getByRole('dialog',{name:episode.title+' · 永久删除确认'});expect(within(dialog).queryByText('关联内容')).toBeNull();expect(document.activeElement).toBe(within(dialog).getByRole('heading',{name:'确认永久删除「'+episode.title+'」'}));
 expect((within(dialog).getByRole('button',{name:'永久删除'})as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(within(dialog).getByRole('button',{name:'取消删除'}));expect(screen.getByRole('dialog',{name:episode.title+' · 清理预览'})).toBeTruthy();expect(document.activeElement).toBe(screen.getByRole('button',{name:'永久删除…'}));expect(vi.mocked(localCommand).mock.calls.map(x=>x[0])).toEqual(['preview','planHistoryDeletion']);
});

it('hides empty archive scopes using whole-history counts and resets an empty initial scope',async()=>{
 vi.mocked(localRequest).mockResolvedValue({...report,items:[],scopeCounts:{active:0,archived:3}});render(<LocalHistory/>);
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'显示范围'})as HTMLSelectElement).value).toBe('all'));
 expect(screen.queryByRole('option',{name:'未归档'})).toBeNull();expect(screen.getByRole('option',{name:'已归档'})).toBeTruthy();
});

it('shows a genuine empty history separately from an empty content filter and resets the latter',async()=>{
 vi.mocked(localRequest).mockResolvedValue({...report,items:[],total:0,totalHistory:0,scopeCounts:{active:0,archived:0}});const app=render(<LocalHistory/>);
 await screen.findByText('尚无生产单历史。');expect(screen.queryByRole('button',{name:'重置历史筛选'})).toBeNull();app.unmount();
 vi.mocked(localRequest).mockResolvedValue({...report,items:[],total:0,totalHistory:2,scopeCounts:{active:0,archived:0}});render(<LocalHistory/>);
 await screen.findByText('没有匹配的历史生产单。');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'重置历史筛选'})));
 const params=new URL(vi.mocked(localRequest).mock.calls.at(-1)![0],'http://local/').searchParams;
 expect(Object.fromEntries(params)).toMatchObject({q:'',state:'all',contentOnly:'false',page:'1',episode:'',filesPage:'1',recordsPage:'1'});
 expect((screen.getByRole('checkbox',{name:'仅显示有生产内容的条目'}) as HTMLInputElement).checked).toBe(false);
 expect(localCommand).not.toHaveBeenCalled();
});
