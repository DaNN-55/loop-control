import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {LocalHistory} from './LocalHistory';
import {localCommand, localRequest} from './client';

vi.mock('./client', () => ({localCommand:vi.fn(), localRequest:vi.fn()}));
const episode = {episode_id:'history-ui-fixture',title:'设计资料',account_name:'示例账号',updated_at:'now',file_count:51,record_count:51,archived_at:null as string|null};
const sha = 'a'.repeat(64);
const raw = '{"large_number":12345678901234567890}';
function reads(item = episode) {
  vi.mocked(localRequest).mockImplementation(async path => {
    const q = new URL(path, 'http://local/').searchParams;
    if(q.has('version')) return {version:{table_name:'public.episodes',payload_json:raw}};
    return {items:[item],total:61,page:Number(q.get('page')||1),pageSize:30,selected:q.get('episode')?item:null,
      files:[{logical_path:'fixture/script.md',sha256:sha,bytes:'2048',title:'说明文档 · script.md',section:'script'}],
      versions:[{table_name:'public.episodes',row_key:{id:item.episode_id},payload_sha256:sha,title:'生产单记录'}],
      pagination:{filesPage:Number(q.get('filesPage')||1),recordsPage:Number(q.get('recordsPage')||1),fileTotal:51,recordTotal:51}};
  });
}
beforeEach(() => {Element.prototype.scrollIntoView = vi.fn();});
afterEach(() => {cleanup();vi.resetAllMocks();});

it('submits search, scope and the Dan UI checkbox through the existing read contract', async () => {
  reads();const user=userEvent.setup();render(<LocalHistory/>);
  await screen.findByText(episode.title);
  await user.type(screen.getByRole('searchbox',{name:'生产单或账号'}),'示例');
  await user.type(screen.getByRole('searchbox',{name:'生产单或账号'}),'{Enter}');
  await user.selectOptions(screen.getByRole('combobox',{name:'显示范围'}),'all');
  await user.click(screen.getByRole('checkbox',{name:'仅显示有生产内容的条目'}));
  await waitFor(() => {
    const q=new URL(vi.mocked(localRequest).mock.calls.at(-1)![0],'http://local/').searchParams;
    expect(q.get('q')).toBe('示例');expect(q.get('state')).toBe('all');
    expect(q.get('contentOnly')).toBe('false');expect(q.get('page')).toBe('1');
  });
  expect(localCommand).not.toHaveBeenCalled();
});

it('keeps file/record pagination independent, download links intact and JSON exact', async () => {
  reads();const user=userEvent.setup();render(<LocalHistory/>);await screen.findByText(episode.title);
  await user.click(screen.getByRole('button',{name:'查看内容 '+episode.title}));
  await screen.findByRole('region',{name:'生产单历史内容'});
  await user.click(screen.getByText('脚本（本页 1 项）'));
  expect(screen.getByRole('link',{name:'fixture/script.md'}).getAttribute('href')).toBe('/api/local/history-file?sha='+sha);
  await user.click(within(screen.getByRole('navigation',{name:'文件分页'})).getByRole('button',{name:'下一页'}));
  await user.click(screen.getByText('技术记录与版本快照（51 项）'));
  await user.click(within(screen.getByRole('navigation',{name:'记录分页'})).getByRole('button',{name:'下一页'}));
  const q=new URL(vi.mocked(localRequest).mock.calls.at(-1)![0],'http://local/').searchParams;
  expect(q.get('filesPage')).toBe('2');expect(q.get('recordsPage')).toBe('2');
  await user.click(screen.getByRole('button',{name:'生产单记录'}));
  expect((await screen.findByText(raw)).textContent).toBe(raw);
  await user.click(screen.getByRole('button',{name:'关闭生产单历史'}));
  await user.type(screen.getByRole('searchbox',{name:'生产单或账号'}),'{Enter}');
  await waitFor(() => expect(screen.queryByRole('region',{name:'生产单历史内容'})).toBeNull());
});

it('locks a pending restore, reports failure and permits retry without deleting anything', async () => {
  reads({...episode,archived_at:'2026-10-27T00:00:00Z'});
  let reject!:(error:Error)=>void;
  vi.mocked(localCommand).mockImplementationOnce(() => new Promise((_resolve, fail) => {reject=fail;})).mockResolvedValueOnce({restored:true});
  const user=userEvent.setup();render(<LocalHistory/>);await screen.findByText(episode.title);
  const restore=screen.getByRole('button',{name:'恢复历史 '+episode.title});
  await user.click(restore);fireEvent.click(restore);
  expect(localCommand).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('combobox',{name:'显示范围'}) as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole('checkbox',{name:'仅显示有生产内容的条目'}) as HTMLInputElement).disabled).toBe(true);
  await act(async () => reject(new Error('恢复暂未完成，请重试。')));
  expect((await screen.findByRole('alert')).textContent).toContain('请重试');
  expect(screen.getByText(episode.title)).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'恢复历史 '+episode.title}));
  await screen.findByText('历史条目已恢复。');
  expect(localCommand).toHaveBeenLastCalledWith('restore',{episodeId:episode.episode_id},undefined,'history-episode-management');
  expect(vi.mocked(localCommand).mock.calls.every(call=>call[0]==='restore')).toBe(true);
});

it('loads sources only when opened and preserves each tab search and source detail', async () => {
  const source={id:'source-fixture',title:'参考资料',label:'/original/reference',category:'diagnostics',kind:'text',imported_at:'2026-10-27T00:00:00Z',rows:'1',files:'0',archived_at:null};
  vi.mocked(localRequest).mockImplementation(async path => {
    const q=new URL(path,'http://local/').searchParams;
    if(path.startsWith('history-episodes?')) return {items:[episode],total:1,page:1,pageSize:30,selected:null,files:[],versions:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,recordTotal:0}};
    return {summary:{versions:'1',files:'0'},sources:[source],source:q.get('source')?source:null,versions:[],files:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,versionTotal:0},sourceCounts:{active:1,archived:0}};
  });
  const user=userEvent.setup();render(<LocalHistory/>);await screen.findByText(episode.title);
  expect(vi.mocked(localRequest).mock.calls.every(([path])=>path.startsWith('history-episodes?'))).toBe(true);
  await user.type(screen.getByRole('searchbox',{name:'生产单或账号'}),'保留搜索');
  await user.click(screen.getByRole('tab',{name:'资料来源'}));
  await user.click(await screen.findByRole('button',{name:'查看 参考资料'}));
  await screen.findByRole('region',{name:'来源资料'});
  await user.type(screen.getByRole('searchbox',{name:'查找来源'}),'来源草稿');
  await user.type(screen.getByRole('searchbox',{name:'查找文件或记录'}),'内容草稿');
  const count=vi.mocked(localRequest).mock.calls.length;
  await user.click(screen.getByRole('tab',{name:'生产单历史'}));
  expect((screen.getByRole('searchbox',{name:'生产单或账号'}) as HTMLInputElement).value).toBe('保留搜索');
  expect(screen.queryByRole('region',{name:'来源资料'})).toBeNull();
  await user.click(screen.getByRole('tab',{name:'资料来源'}));
  expect((screen.getByRole('searchbox',{name:'查找来源'}) as HTMLInputElement).value).toBe('来源草稿');
  expect((screen.getByRole('searchbox',{name:'查找文件或记录'}) as HTMLInputElement).value).toBe('内容草稿');
  expect(screen.getByRole('region',{name:'来源资料'})).toBeTruthy();
  expect(localRequest).toHaveBeenCalledTimes(count);
  expect(localCommand).not.toHaveBeenCalled();
});

it('opens history in a dismissable dialog and restores focus without reloading the list', async () => {
 reads();const user=userEvent.setup();render(<LocalHistory/>);const trigger=await screen.findByRole('button',{name:'查看内容 '+episode.title});
 await user.click(trigger);const dialog=await screen.findByRole('dialog',{name:episode.title+' · 历史资料'});
 expect(within(dialog).getByRole('region',{name:'生产单历史内容'})).toBeTruthy();
 expect(screen.getByText('技术记录与版本快照（51 项）').closest('details')?.open).toBe(false);
 const readsBeforeClose=vi.mocked(localRequest).mock.calls.length;
 await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(localRequest).toHaveBeenCalledTimes(readsBeforeClose);
 await waitFor(()=>expect(document.activeElement).toBe(trigger));
 expect(localCommand).not.toHaveBeenCalled();
});

it('ignores a record response received after the history dialog closes', async () => {
 reads();const read=vi.mocked(localRequest).getMockImplementation()!;
 let finish!:(value:unknown)=>void;
 vi.mocked(localRequest).mockImplementation((path,...args)=>path.startsWith('history?version=')?new Promise(resolve=>{finish=resolve;}):read(path,...args));
 const user=userEvent.setup();render(<LocalHistory/>);await user.click(await screen.findByRole('button',{name:'查看内容 '+episode.title}));
 await user.click(await screen.findByText('技术记录与版本快照（51 项）'));await user.click(screen.getByRole('button',{name:'生产单记录'}));
 await user.click(screen.getByRole('button',{name:'关闭生产单历史'}));
 await act(async()=>finish({version:{table_name:'public.episodes',payload_json:'stale-response'}}));
 expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByText('stale-response')).toBeNull();expect(localCommand).not.toHaveBeenCalled();
});
