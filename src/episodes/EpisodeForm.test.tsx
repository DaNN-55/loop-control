import {act,cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {EpisodeForm} from './EpisodeForm';
import type {Database} from '../lib/database.types';
type Account=Database['public']['Tables']['accounts']['Row'];
const accounts=[{id:'fixture',name:'测试账号',current_blueprint_version_id:'blueprint'}] as Account[];
afterEach(cleanup);
it('opens a new production order at its working title',()=>{
 render(<EpisodeForm accounts={accounts} isPending={false} onClose={()=>{}} onSubmit={async()=>null} series={[]} seriesVersions={[]}/>);
 expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'工作标题（可留空）'}));
});

it('keeps API failures in the dialog and preserves the working title for retry',async()=>{
 const user=userEvent.setup();
 render(<EpisodeForm accounts={accounts} isPending={false} onClose={()=>{}} onSubmit={async()=>{throw new Error('生产目录不可写，请选择其他目录。');}} series={[]} seriesVersions={[]}/>);
 await user.type(screen.getByRole('textbox',{name:'工作标题（可留空）'}),'日照金山');
 await user.click(screen.getByRole('button',{name:'创建生产单'}));
 const dialog=screen.getByRole('dialog',{name:'新建生产单'});
 expect((await within(dialog).findByRole('alert')).textContent).toContain('生产目录不可写，请选择其他目录。');
 expect((screen.getByRole('textbox',{name:'工作标题（可留空）'}) as HTMLInputElement).value).toBe('日照金山');
});

it('blocks duplicate submissions and closing while its submit promise is pending',async()=>{
 const user=userEvent.setup(),close=vi.fn();let finish!:(value:null)=>void;
 const submit=vi.fn(()=>new Promise<null>(resolve=>{finish=resolve;}));
 render(<EpisodeForm accounts={accounts} isPending={false} onClose={close} onSubmit={submit} series={[]} seriesVersions={[]}/>);
 await user.click(screen.getByRole('button',{name:'创建生产单'}));
 await user.keyboard('{Escape}');expect(close).not.toHaveBeenCalled();
 expect((screen.getByRole('button',{name:'正在处理…'}) as HTMLButtonElement).disabled).toBe(true);
 await user.click(screen.getByRole('button',{name:'正在处理…'}));expect(submit).toHaveBeenCalledTimes(1);
 await act(async()=>finish(null));
 expect((screen.getByRole('button',{name:'创建生产单'}) as HTMLButtonElement).disabled).toBe(false);
});

it('inherits the current account and offers only its current series versions for a new order',async()=>{
 const user=userEvent.setup(),submit=vi.fn(async()=>null);
 const other={...accounts[0],id:'other',name:'其他账号'};
 const series=[{id:'series',account_id:'other',name:'其他系列'},{id:'daily-series',account_id:'fixture',name:'日常系列'}] as Parameters<typeof EpisodeForm>[0]['series'];
 const versions=[{id:'old',account_id:'fixture',series_id:'daily-series',version:1},{id:'current',account_id:'fixture',series_id:'daily-series',version:3},{id:'other-version',account_id:'other',series_id:'series',version:2}] as Parameters<typeof EpisodeForm>[0]['seriesVersions'];
 render(<EpisodeForm accounts={[other,...accounts]} initialAccountId="fixture" isPending={false} onClose={()=>{}} onSubmit={submit} series={series} seriesVersions={versions}/>);
 expect((screen.getByRole('combobox',{name:'账号'}) as HTMLSelectElement).value).toBe('fixture');
 expect(screen.getByRole('option',{name:'日常系列 · 当前 v3'})).toBeTruthy();
 expect(screen.queryByRole('option',{name:/v1/})).toBeNull();expect(screen.queryByRole('option',{name:/其他系列/})).toBeNull();
 await user.selectOptions(screen.getByRole('combobox',{name:'系列版本'}),'current');
 await user.selectOptions(screen.getByRole('combobox',{name:'账号'}),'other');
 expect((screen.getByRole('combobox',{name:'系列版本'}) as HTMLSelectElement).value).toBe('');
 await user.selectOptions(screen.getByRole('combobox',{name:'系列版本'}),'other-version');
 await user.click(screen.getByRole('button',{name:'创建生产单'}));
 expect(submit).toHaveBeenCalledWith({accountId:'other',seriesVersionId:'other-version',title:'',isTest:false});
});
