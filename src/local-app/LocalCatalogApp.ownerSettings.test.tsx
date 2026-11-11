import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalCatalogApp} from './LocalCatalogApp';
import {ownerSettingsFixture} from './fixtures/ownerSettingsFixture';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();localStorage.clear();sessionStorage.clear();history.replaceState(null,'','/');});
function setup(){const f=ownerSettingsFixture();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(f.request));return f;}
async function openSettings(name='个人偏好'){fireEvent.click(await screen.findByRole('button',{name:'所有者设置'}));fireEvent.click(await screen.findByRole('menuitem',{name}));return screen.findByRole('dialog',{name});}
it('opens every real settings page in one frame with its actual content and restores focus',async()=>{
 const f=setup();render(<LocalCatalogApp/>);await openSettings();
 for(const label of ['通知','登录与安全','日志','回收站','连接配置','密钥管理','个人偏好']){fireEvent.click(within(screen.getByRole('navigation',{name:'设置页面'})).getByRole('button',{name:label}));await screen.findByRole('dialog',{name:label});expect(screen.getAllByRole('dialog')).toHaveLength(1);}
 fireEvent.keyDown(window,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(document.activeElement).toBe(screen.getByRole('button',{name:'所有者设置'}));expect(f.writes).toEqual([]);
});
it('protects edited preferences during a page switch and saves through the actual preference API',async()=>{
 const f=setup();render(<LocalCatalogApp/>);await openSettings();await screen.findByRole('textbox',{name:'显示名称'});fireEvent.change(screen.getByRole('textbox',{name:'显示名称'}),{target:{value:'未保存名称'}});fireEvent.click(within(screen.getByRole('navigation',{name:'设置页面'})).getByRole('button',{name:'通知'}));
 await screen.findByRole('dialog',{name:'离开当前设置？'});fireEvent.click(screen.getByRole('button',{name:'继续编辑'}));expect(screen.getByRole('textbox',{name:'显示名称'})).toHaveProperty('value','未保存名称');fireEvent.click(screen.getByRole('button',{name:'保存偏好'}));await screen.findByText('已保存');expect(f.preferences.displayName).toBe('未保存名称');await waitFor(()=>expect(within(screen.getByRole('navigation',{name:'设置页面'})).getByRole('button',{name:'通知'})).toHaveProperty('disabled',false));fireEvent.click(within(screen.getByRole('navigation',{name:'设置页面'})).getByRole('button',{name:'通知'}));await screen.findByRole('dialog',{name:'通知'});expect(f.writes).toEqual([{path:'preferences',command:'update'}]);
});
it('links connection keys to one fixed sensitive pane and global metadata back to the connection',async()=>{
 const f=setup();render(<LocalCatalogApp/>);await openSettings('连接配置');fireEvent.click(await screen.findByRole('button',{name:'演示图片连接'}));fireEvent.click(await screen.findByRole('button',{name:'查看密钥'}));expect(await screen.findByLabelText('当前登录密码')).toBeTruthy();expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(screen.getAllByRole('dialog')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'返回连接详情'}));expect(await screen.findByRole('textbox',{name:'连接名称'})).toBeTruthy();fireEvent.click(within(screen.getByRole('navigation',{name:'设置页面'})).getByRole('button',{name:'密钥管理'}));await screen.findByRole('dialog',{name:'密钥管理'});fireEvent.click(await screen.findByRole('button',{name:'打开密钥分组：演示图片连接'}));fireEvent.click(await screen.findByRole('button',{name:'演示图片连接 v1'}));fireEvent.click(await screen.findByRole('button',{name:'前往连接更换密钥'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'连接名称'})).toHaveProperty('value','演示图片连接'));expect(screen.queryByLabelText('密钥明文')).toBeNull();expect(f.writes).toEqual([]);
});
it('does not switch away while a real preference save is in flight',async()=>{
 const f=setup();let finish!:(value:Response)=>void;const original=f.request;vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>init?.method==='POST'&&String(input).endsWith('/preferences')?new Promise<Response>(resolve=>{finish=resolve;}):original(input,init)));
 render(<LocalCatalogApp/>);await openSettings();fireEvent.change(await screen.findByRole('textbox',{name:'显示名称'}),{target:{value:'保存中名称'}});fireEvent.click(screen.getByRole('button',{name:'保存偏好'}));await waitFor(()=>expect(within(screen.getByRole('navigation',{name:'设置页面'})).getByRole('button',{name:'通知'})).toHaveProperty('disabled',true));await act(async()=>finish(Response.json({...f.preferences,displayName:'保存中名称'})));await screen.findByText('已保存');expect(within(screen.getByRole('navigation',{name:'设置页面'})).getByRole('button',{name:'通知'})).toHaveProperty('disabled',false);
});
