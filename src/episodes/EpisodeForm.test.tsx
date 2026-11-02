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
