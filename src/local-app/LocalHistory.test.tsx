import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {HistorySources as LocalHistory} from './HistorySources';
import {localCommand,localRequest} from './client';
vi.mock('./client',()=>({localRequest:vi.fn(),localCommand:vi.fn()}));
beforeEach(()=>{Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>{cleanup();vi.resetAllMocks();});
const sha='a'.repeat(64),source='b'.repeat(64);
const item={id:source,label:'/old/stage-d/raw-path/business.dump',kind:'postgres',imported_at:'2026-10-26T12:00:00Z',rows:'1',files:'1',archived_at:null,category:'diagnostics' as const,title:'Stage D · 数据库快照 · bbbbbbbb'};
const report={summary:{versions:'1',files:'1'},sources:[item],source:null as typeof item|null,versions:[{table_name:'public.episodes',row_key:{id:1},payload_sha256:sha,label:'原始生产单',title:'生产单 · 原始生产单',status:'history-only'}],files:[{logical_path:'old/files/sample.txt',title:'文件 · sample.txt',sha256:sha,bytes:'123',kind:'text',category:'diagnostics'}],pagination:{filesPage:1,recordsPage:1,fileTotal:1,versionTotal:1},sourceCounts:{active:1,archived:0}};
function requests(raw='{"large_number":12345678901234567890}'){
 vi.mocked(localRequest).mockImplementation(async path=>path.includes('version=')?{version:{table_name:'public.episodes',row_key:{id:1},payload_json:raw}}:{...report,source:new URL(path,'http://local/').searchParams.get('source')?item:null});
}
async function open(user:ReturnType<typeof userEvent.setup>){await screen.findByRole('table',{name:'资料来源列表'});await user.click(screen.getByRole('button',{name:'查看 '+item.title}));await screen.findByRole('heading',{name:item.title});}
it('lists source rows and keeps raw names, file paths and exact JSON in on-demand details',async()=>{
 requests();const user=userEvent.setup();render(<LocalHistory/>);
 expect(await screen.findByRole('table',{name:'资料来源列表'})).toBeTruthy();expect(screen.getByRole('cell',{name:'测试与诊断'})).toBeTruthy();
 expect(screen.queryByRole('link')).toBeNull();await open(user);
 expect(screen.getByText('原始来源信息').closest('details')!.open).toBe(false);
 expect(screen.getByText('文件（1 项）').closest('details')!.open).toBe(false);
 await user.click(screen.getByText('文件（1 项）'));
 expect(screen.getByRole('link',{name:'old/files/sample.txt'}).getAttribute('href')).toBe('/api/local/history-file?sha='+sha);
 expect(screen.getByText('原路径与摘要').closest('details')!.open).toBe(false);
 await user.click(screen.getByText('技术记录（1 项）'));await user.click(screen.getByRole('button',{name:'生产单 · 原始生产单'}));
 const details=(await screen.findByText('技术详情')).closest('details')!;expect(details.open).toBe(false);expect(within(details).getByText('{"large_number":12345678901234567890}').textContent).toContain('12345678901234567890');
 expect(localCommand).not.toHaveBeenCalled();
});
it('archives through the protected command and can filter archived sources without deleting',async()=>{
 requests();vi.mocked(localCommand).mockImplementation(async()=>{vi.mocked(localRequest).mockResolvedValue({...report,sources:[],sourceCounts:{active:0,archived:1}});return {archived:true};});const user=userEvent.setup();render(<LocalHistory/>);
 await screen.findByRole('table',{name:'资料来源列表'});await user.click(screen.getByRole('button',{name:'归档 '+item.title}));
 await screen.findByText('已归档，可在「已归档」中恢复。文件和索引保留。');expect(localCommand).toHaveBeenCalledWith('archive',{sourceId:source},undefined,'history-management');
 await user.selectOptions(screen.getByLabelText('显示范围'),'archived');await waitFor(()=>expect(new URL(vi.mocked(localRequest).mock.calls.at(-1)![0],'http://local/').searchParams.get('state')).toBe('archived'));
});
it('locks repeated preview and reports unreviewed bytes without exposing a delete action',async()=>{
 requests();let finish!:(value:unknown)=>void;vi.mocked(localCommand).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<LocalHistory/>);
 await screen.findByRole('table',{name:'资料来源列表'});const button=screen.getByRole('button',{name:'永久清理预览 '+item.title});fireEvent.click(button);fireEvent.click(button);expect(localCommand).toHaveBeenCalledTimes(1);expect((button as HTMLButtonElement).disabled).toBe(true);
 finish({sourceId:source,deletionEnabled:false,checkedAt:'now',fileLinks:10,contents:8,sharedContents:2,protectedContents:3,reviewContents:3,reviewBytes:2048,recordLinks:4,sharedRecords:2,projectedRecords:1,samples:[{logical_path:'fixture.txt',state:'needs-review'}]});
 const preview=await screen.findByRole('region',{name:'永久清理预览'});expect(preview.textContent).toContain('3 份内容 · 2.0 KB');expect(preview.textContent).toContain('待核查大小不等于可释放空间');expect(within(preview).queryByRole('button',{name:/删除|执行/})).toBeNull();expect(screen.getByText('核查样例（最多 12 项）').closest('details')!.open).toBe(false);
});
it('reports read failures and retains search input for retry',async()=>{
 vi.mocked(localRequest).mockRejectedValueOnce(new Error('历史暂不可用。')).mockResolvedValue(report);const user=userEvent.setup();render(<LocalHistory/>);await screen.findByRole('alert');await user.type(screen.getByRole('searchbox',{name:'查找来源'}),'Stage');await user.type(screen.getByRole('searchbox',{name:'查找来源'}),'{Enter}');await screen.findByRole('table',{name:'资料来源列表'});expect(screen.queryByRole('alert')).toBeNull();expect(new URL(vi.mocked(localRequest).mock.calls.at(-1)![0],'http://local/').searchParams.get('sourcesQ')).toBe('Stage');
});
it('discards details that finish after a new content search',async()=>{
 let finish!:(value:unknown)=>void;requests();vi.mocked(localRequest).mockImplementation(async path=>path.includes('version=')?new Promise(resolve=>{finish=resolve;}):{...report,source:item});const user=userEvent.setup();render(<LocalHistory/>);await open(user);await user.click(screen.getByText('技术记录（1 项）'));await user.click(screen.getByRole('button',{name:'生产单 · 原始生产单'}));await user.type(screen.getByRole('searchbox',{name:'查找文件或记录'}),'{Enter}');await waitFor(()=>expect(screen.queryByRole('region',{name:'选定历史记录'})).toBeNull());finish({version:{table_name:'public.episodes',payload_json:'stale',row_key:{}}});await waitFor(()=>expect(screen.queryByText('技术详情')).toBeNull());
});

it('shows only populated source categories and keeps them during an empty search',async()=>{
 vi.mocked(localRequest).mockResolvedValue({...report,sources:[],categoryCounts:{diagnostics:4}});render(<LocalHistory/>);await screen.findByRole('table');
 const category=screen.getByRole('combobox',{name:'分类'});expect(within(category).getAllByRole('option').map(option=>option.textContent)).toEqual(['全部分类','测试与诊断']);
 expect(within(screen.getByRole('combobox',{name:'显示范围'})).queryByRole('option',{name:/已归档/})).toBeNull();
});

it('distinguishes an empty history library and offers a read-only refresh',async()=>{
 vi.mocked(localRequest).mockResolvedValue({...report,sources:[],summary:{versions:'0',files:'0'},sourceCounts:{active:0,archived:0}});
 const user=userEvent.setup();render(<LocalHistory/>);
 await screen.findByText('尚无独立历史资料。');
 expect(screen.queryByRole('button',{name:'重置来源筛选'})).toBeNull();
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'显示范围'}) as HTMLSelectElement).value).toBe('all'));
 const reads=vi.mocked(localRequest).mock.calls.length;
 await user.click(screen.getByRole('button',{name:'重新读取资料来源'}));
 await waitFor(()=>expect(localRequest).toHaveBeenCalledTimes(reads+1));
 expect(localCommand).not.toHaveBeenCalled();
});

it('keeps committed source filters until reset and resets the complete lookup without writes',async()=>{
 vi.mocked(localRequest).mockImplementation(async path=>({...report,sources:new URL(path,'http://local/').searchParams.get('sourcesQ')?[]:[item],categoryCounts:{diagnostics:1}}));
 const user=userEvent.setup();render(<LocalHistory/>);await screen.findByRole('table');
 await user.selectOptions(screen.getByRole('combobox',{name:'分类'}),'diagnostics');
 await user.type(screen.getByRole('searchbox',{name:'查找来源'}),'不存在{Enter}');
 await screen.findByText('没有匹配的资料来源。');
 expect((screen.getByRole('searchbox',{name:'查找来源'}) as HTMLInputElement).value).toBe('不存在');
 expect((screen.getByRole('combobox',{name:'分类'}) as HTMLSelectElement).value).toBe('diagnostics');
 await user.click(screen.getByRole('button',{name:'重置来源筛选'}));
 await screen.findByRole('button',{name:'查看 '+item.title});
 const params=new URL(vi.mocked(localRequest).mock.calls.at(-1)![0],'http://local/').searchParams;
 expect(Object.fromEntries(params)).toMatchObject({source:'',sourcesQ:'',q:'',category:'',state:'all',filesPage:'1',recordsPage:'1'});
 expect((screen.getByRole('searchbox',{name:'查找来源'}) as HTMLInputElement).value).toBe('');
 expect(localCommand).not.toHaveBeenCalled();
});

it('distinguishes missing source content from a content search with no results',async()=>{
 vi.mocked(localRequest).mockResolvedValue({...report,source:item,files:[],versions:[],pagination:{filesPage:1,recordsPage:1,fileTotal:0,versionTotal:0}});
 const user=userEvent.setup();render(<LocalHistory/>);await open(user);
 await user.click(screen.getByText('文件（0 项）'));await user.click(screen.getByText('技术记录（0 项）'));
 expect(screen.getByText('此来源没有登记的历史文件。')).toBeTruthy();
 expect(screen.getByText('此来源没有留存的技术记录。')).toBeTruthy();
 await user.type(screen.getByRole('searchbox',{name:'查找文件或记录'}),'找不到{Enter}');
 await screen.findByText('没有匹配的历史文件。');
 await user.click(screen.getByRole('button',{name:'清除内容搜索'}));
 await screen.findByText('此来源没有登记的历史文件。');
 expect(new URL(vi.mocked(localRequest).mock.calls.at(-1)![0],'http://local/').searchParams.get('q')).toBe('');
 expect(localCommand).not.toHaveBeenCalled();
});
