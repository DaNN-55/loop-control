import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {LocalCatalogApp} from './LocalCatalogApp';
vi.mock('./LocalSystemStatus',()=>({LocalSystemStatus:()=>null}));
const catalog={accounts:[],blueprints:[],blueprintRevisions:{},episodes:[],series:[],seriesVersions:[],promptVersions:[],page:1,total:0,pageSize:20,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{total:0,items:[]},blocked:{total:0,items:[]},worker:{running:0,blocked:0,failed:0},operationRows:[]};
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();history.replaceState(null,'','/');localStorage.clear();sessionStorage.clear();});
it('quietly reads only the catalog and pauses when hidden or a protected dialog is open',async()=>{
 vi.useFakeTimers();const reads:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{reads.push(path);if(path.endsWith('/session'))return Response.json({owner:{id:'fixture'},csrfToken:'fixture'});if(path.includes('/catalog?'))return Response.json(catalog);return Response.json({connections:[],versions:[]});}));
 await act(async()=>{render(<LocalCatalogApp/>);});
 await act(async()=>{fireEvent.click(within(screen.getByRole('complementary',{name:'主导航'})).getByRole('button',{name:'生产单'}));});
 expect(screen.queryByRole('button',{name:'刷新'})).toBeNull();const before=reads.length;
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(reads.slice(before)).toHaveLength(1);expect(reads.at(-1)).toContain('/catalog?');
 const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(true);const hiddenStart=reads.length;
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(reads).toHaveLength(hiddenStart);hidden.mockReturnValue(false);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'新建生产单'}));});expect(screen.getByRole('dialog',{name:'新建生产单'})).toBeTruthy();
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(reads).toHaveLength(hiddenStart);
});
it('keeps an explicit read retry when the quiet update fails',async()=>{
 vi.useFakeTimers();let fail=false;const requests:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{requests.push(path);if(path.endsWith('/session'))return Response.json({owner:{id:'fixture'},csrfToken:'fixture'});if(path.includes('/catalog?'))return fail?Response.json({error:'目录暂不可用'},{status:503}):Response.json(catalog);return Response.json({connections:[],versions:[]});}));
 await act(async()=>{render(<LocalCatalogApp/>);});await act(async()=>{fireEvent.click(within(screen.getByRole('complementary',{name:'主导航'})).getByRole('button',{name:'生产单'}));});
 fail=true;await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(screen.getByRole('alert').textContent).toContain('目录暂不可用');const before=requests.length;fail=false;
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'重新读取'}));});expect(requests.slice(before).some(path=>path.includes('/catalog?'))).toBe(true);expect(screen.queryByRole('alert')).toBeNull();
});
