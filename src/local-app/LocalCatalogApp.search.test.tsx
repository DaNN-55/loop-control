import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import {draftOwner,draftEpisode,draftCatalog,draftSnapshot,draftWorkspace} from './fixtures/workspaceDraftFixture';
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();history.replaceState(null,'','/');});
function fixture(target=draftEpisode, name='main-script.md', fileType='script', title='search-main-script.md'){const writes:string[]=[];vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(init?.method==='POST'){writes.push(path);return Response.json({error:'No writes allowed'},{status:400});}if(path.endsWith('/session'))return Response.json({csrfToken:'synthetic',owner:{id:draftOwner}});if(path.includes('/history-episodes?'))return Response.json({items:[],total:0,totalHistory:0,page:1,pageSize:20,scopeCounts:{active:0,archived:0}});if(path.includes('/history?'))return Response.json({sources:[],summary:{versions:'0',files:'0'},sourceCounts:{active:0,archived:0}});if(path.includes('/catalog?'))return Response.json(draftCatalog);if(path.includes('/workspace-search?'))return Response.json({query:'Needle',episodes:[],accounts:[],materials:[{id:'file',kind:'material',episodeId:target,path:name,sha256:'a'.repeat(64),title,subtitle:'所属生产单',fileType}],hasMore:{episodes:false,accounts:false,materials:false},pagination:{category:'materials',page:2,pageSize:8,total:{episodes:0,accounts:0,materials:9},pages:{episodes:1,accounts:1,materials:2}}});if(path.endsWith('/workspace'))return Response.json({workspace:draftWorkspace(new URL(path,'http://localhost').pathname.split('/')[4])});if(path.includes('?known='))return Response.json({hashes:{},sections:draftSnapshot(new URL(path,'http://localhost').pathname.split('/')[4])});if(path.includes('/workspace/project?'))return Response.json({project:null});return Response.json({connections:[],versions:[],capabilities:{secrets:'synthetic',verification:'disabled',externalReady:false},serviceCatalog:{groups:[]}});}));return writes;}
it('reloads a search destination closed, restores full page two with Back, and keeps Forward after closing the popup',async()=>{
 history.replaceState(null,'','/?view=episodes&searchQ=Needle&searchCategory=materials&searchPage=2&outside=kept');const writes=fixture(),user=userEvent.setup();let app=render(<LocalCatalogApp/>);await user.click(await screen.findByRole('textbox',{name:'查找生产单、账号或素材'}));await user.click(await screen.findByRole('button',{name:'打开所属生产单'}));await screen.findByLabelText('主脚本');expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull();expect(new URLSearchParams(location.search).get('searchOpen')).toBe('0');expect(new URLSearchParams(location.search).get('outside')).toBe('kept');
 app.unmount();app=render(<LocalCatalogApp/>);await screen.findByLabelText('主脚本');expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull();act(()=>history.back());await waitFor(()=>expect(new URLSearchParams(location.search).get('episode')).toBeNull());expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull();await user.click(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}));await screen.findByText('search-main-script.md');expect(screen.getByText('共 9 项 · 第 2 / 2 页')).toBeTruthy();expect(new URLSearchParams(location.search).get('episode')).toBeNull();await user.click(screen.getByRole('button',{name:'关闭工作区搜索'}));act(()=>history.forward());await screen.findByLabelText('主脚本');expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull();expect(new URLSearchParams(location.search).get('searchPage')).toBe('2');expect(writes).toEqual([]);
});
it('keeps the current draft and full address when a search destination is cancelled at the leave guard',async()=>{
 history.replaceState(null,'',`/?view=episodes&episode=${draftEpisode}&searchQ=Needle&searchCategory=materials&searchPage=2&searchOpen=0&outside=kept`);const writes=fixture('another-production'),user=userEvent.setup();render(<LocalCatalogApp/>);fireEvent.change(await screen.findByLabelText('主脚本'),{target:{value:'留在本页的脚本草稿'}});const before=location.search;await user.click(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}));await user.click(await screen.findByRole('button',{name:'打开所属生产单'}));await screen.findByRole('dialog',{name:'保留未提交内容'});expect(location.search).toBe(before);await user.click(screen.getByRole('button',{name:'继续编辑'}));expect((screen.getByLabelText('主脚本') as HTMLTextAreaElement).value).toBe('留在本页的脚本草稿');await waitFor(()=>expect(location.search).toBe(before));expect(writes).toEqual([]);
});
it('retains an ordinary typed search on refresh without adding one history entry per query',async()=>{
 history.replaceState(null,'','/?view=episodes&outside=kept');const writes=fixture();let app=render(<LocalCatalogApp/>);const input=await screen.findByRole('textbox',{name:'查找生产单、账号或素材'});fireEvent.focus(input);const index=history.state.loopCatalogNavigation.index;
 fireEvent.change(input,{target:{value:'Need'}});await waitFor(()=>expect(new URLSearchParams(location.search).get('searchQ')).toBe('Need'));
 fireEvent.change(input,{target:{value:'Needle'}});await screen.findByText('search-main-script.md');await waitFor(()=>expect(new URLSearchParams(location.search).get('searchQ')).toBe('Needle'));expect(history.state.loopCatalogNavigation.index).toBe(index);expect(new URLSearchParams(location.search).get('outside')).toBe('kept');
 app.unmount();app=render(<LocalCatalogApp/>);await screen.findByRole('textbox',{name:'查找生产单、账号或素材'});expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull();expect((screen.getByRole('textbox',{name:'查找生产单、账号或素材'}) as HTMLInputElement).value).toBe('Needle');expect(writes).toEqual([]);
});
it('clears the saved ordinary search at the same debounce boundary',async()=>{
 history.replaceState(null,'','/?view=episodes&searchQ=Needle');fixture();render(<LocalCatalogApp/>);await userEvent.click(await screen.findByRole('textbox',{name:'查找生产单、账号或素材'}));await screen.findByText('search-main-script.md');fireEvent.change(screen.getByRole('textbox',{name:'查找生产单、账号或素材'}),{target:{value:''}});await waitFor(()=>expect(new URLSearchParams(location.search).has('searchQ')).toBe(false));cleanup();render(<LocalCatalogApp/>);expect((await screen.findByRole('textbox',{name:'查找生产单、账号或素材'}) as HTMLInputElement).value).toBe('');
});
it('exposes rich search results as a controlled region and keeps the keyboard preview path',async()=>{
 history.replaceState(null,'','/?view=episodes');const writes=fixture(),user=userEvent.setup();render(<LocalCatalogApp/>);const input=await screen.findByRole('textbox',{name:'查找生产单、账号或素材'});expect(input.hasAttribute('aria-expanded')).toBe(false);expect(input.hasAttribute('aria-controls')).toBe(false);
 await user.click(input);await user.type(input,'Needle');await screen.findByText('search-main-script.md');const results=screen.getByRole('region',{name:'工作区搜索结果'});expect(input.getAttribute('aria-controls')).toBe(results.id);expect(input.hasAttribute('aria-expanded')).toBe(false);await user.keyboard('{ArrowDown}');expect(document.activeElement).toBe(screen.getByRole('button',{name:'预览 search-main-script.md'}));await user.keyboard('{Escape}');expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull();expect(document.activeElement).toBe(input);expect(input.hasAttribute('aria-controls')).toBe(false);expect(writes).toEqual([]);
});

it('Escape from file preview restores the result controls while leaving search open',async()=>{
 history.replaceState(null,'','/?view=episodes&searchQ=Needle');fixture();const user=userEvent.setup();render(<LocalCatalogApp/>);await user.click(await screen.findByRole('textbox',{name:'查找生产单、账号或素材'}));await user.click(await screen.findByRole('button',{name:'预览 search-main-script.md'}));await screen.findByRole('button',{name:'关闭预览'});await user.keyboard('{Escape}');expect(screen.queryByRole('button',{name:'关闭预览'})).toBeNull();expect(screen.getByRole('region',{name:'工作区搜索结果'})).toBeTruthy();expect(document.activeElement).toBe(screen.getByRole('button',{name:'预览 search-main-script.md'}));
});

it('previews a PNG even when an older search response labels it as a generic file', async () => {
 history.replaceState(null, '', '/?view=episodes&searchQ=Needle');
 fixture(draftEpisode, '首帧.png', 'file', '首帧.png');
 render(<LocalCatalogApp/>);
 await userEvent.click(await screen.findByRole('textbox',{name:'查找生产单、账号或素材'}));
 await userEvent.click(await screen.findByRole('button', {name:'预览 首帧.png'}));
 expect(screen.getByRole('img', {name:'首帧.png'}).getAttribute('src')).toContain('/_local-artifact?');
});

it.each([
 {name:'checks.json',canPreview:true},
 {name:'delivery.zip',canPreview:false},
])('offers the correct file actions for $name',async({name,canPreview})=>{
 history.replaceState(null,'','/?view=episodes&searchQ=Needle');
 fixture(draftEpisode,name,'file',name);
 render(<LocalCatalogApp/>);
 await userEvent.click(await screen.findByRole('textbox',{name:'查找生产单、账号或素材'}));
 expect(await screen.findByRole('link',{name:`下载 ${name}`})).toBeTruthy();
 const preview=screen.queryByRole('button',{name:`预览 ${name}`});
 if(!canPreview){expect(preview).toBeNull();return;}
 await userEvent.click(preview!);
 expect(await screen.findByText(/"serviceCatalog":/)).toBeTruthy();
});


it.each(['view=operations','view=episodes','view=episodes&episode='+draftEpisode,'view=accounts','view=connections','view=history','view=history&historyTab=sources'])('opens %s with search closed even when its keyword is saved',async(route)=>{
 history.replaceState(null,'','/?'+route+'&searchQ=Needle');
 fixture();
 render(<LocalCatalogApp/>);
 const input=await screen.findByRole<HTMLInputElement>('textbox',{name:'查找生产单、账号或素材'});
 expect(input.value).toBe('Needle');
 act(()=>input.focus());
 expect(screen.queryByRole('region',{name:'工作区搜索结果'})).toBeNull();
 expect(vi.mocked(fetch).mock.calls.some(([path])=>String(path).includes('/workspace-search?'))).toBe(false);
});
