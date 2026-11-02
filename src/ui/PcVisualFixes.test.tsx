import {cleanup, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, it, vi} from 'vitest';
import {useState} from 'react';
import {AccountForm} from '../accounts/AccountForm';
import {SeriesSettings} from '../accounts/AccountWorkspace';
import {EpisodeForm} from '../episodes/EpisodeForm';
import {Input} from './dan-ui/components/base/input/input';
import {Tabs} from './dan-ui/components/application/tabs/tabs';

vi.mock('../lib/viewTransport', () => ({viewTransport: {}}));
afterEach(cleanup);

it('disables native pending inputs and keeps keyboard focus inside an all-disabled dialog', async () => {
  const user = userEvent.setup(), close = vi.fn(), submit = vi.fn();
  render(<><button>外部操作</button><AccountForm isPending onClose={close} onSubmit={submit}/></>);
  const dialog = screen.getByRole('dialog', {name:'新建账号'});
  for (const input of within(dialog).getAllByRole('textbox')) expect((input as HTMLInputElement).disabled).toBe(true);
  for (const key of ['{Tab}', '{Shift>}{Tab}{/Shift}', '{Escape}']) {
    await user.keyboard(key);
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  expect(close).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it('preserves TextField context disabling for the input and password toggle', () => {
  render(<Input label="测试口令" type="password" isDisabled/>);
  expect((screen.getByLabelText(/^测试口令/) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', {name:'显示密码'}) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps a forced-mounted draft while marking the inactive tab inert', async () => {
  const user = userEvent.setup();
  function Panels() {
    const [value, setValue] = useState('');
    return <Tabs defaultSelectedKey="text"><Tabs.List aria-label="工作区"><Tabs.Item id="text">文字</Tabs.Item><Tabs.Item id="visual">画面</Tabs.Item></Tabs.List><Tabs.Panel id="text" shouldForceMount><input aria-label="草稿" value={value} onChange={e=>setValue(e.target.value)}/></Tabs.Panel><Tabs.Panel id="visual" shouldForceMount>画面内容</Tabs.Panel></Tabs>;
  }
  const {container} = render(<Panels/>);
  await user.type(screen.getByLabelText('草稿'), '保留已编辑内容');
  await user.click(screen.getByRole('tab', {name:'画面'}));
  const inactive = container.querySelector('[data-inert="true"]')!;
  expect(inactive).not.toBeNull();
  expect(inactive.querySelector('input')?.value).toBe('保留已编辑内容');
  await user.click(screen.getByRole('tab', {name:'文字'}));
  expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('保留已编辑内容');
});

it('paginates 1284 series, searches all pages, and keeps the current editor draft while browsing', async () => {
  const user = userEvent.setup();
  const series = Array.from({length:1284}, (_, i) => ({id:`series-${i}`, account_id:'account', created_at:'2026-10-28T00:00:00Z', name:`联合制作系列 ${i + 1}`}));
  const {container} = render(<SeriesSettings isPending={false} onCreate={vi.fn()} series={series} seriesVersions={[]}/>);
  const list = container.querySelector<HTMLElement>('.series-current-layout > aside > nav')!;
  expect(list.querySelectorAll(':scope > button.account-series-entry').length).toBe(20);
  await user.click(screen.getByRole('button', {name:'修改'}));
  const positioning = screen.getByLabelText('系列定位');
  await user.type(positioning, '未保存的定位');
  await user.click(within(screen.getByRole('navigation', {name:'系列分页'})).getByRole('button', {name:'下一页'}));
  expect((positioning as HTMLTextAreaElement).value).toBe('未保存的定位');
  expect(list.textContent).toContain('联合制作系列 21');
  await user.type(screen.getByRole('searchbox', {name:'查找系列'}), '1284');
  expect(list.querySelectorAll(':scope > button.account-series-entry').length).toBe(2);
  expect(within(list).getByRole('button', {name:'联合制作系列 1'}).getAttribute('aria-current')).toBe('page');
  expect(list.textContent).toContain('联合制作系列 1284');
  expect(screen.queryByRole('navigation', {name:'系列分页'})).toBeNull();
  await user.clear(screen.getByRole('searchbox', {name:'查找系列'}));
  await user.type(screen.getByRole('searchbox', {name:'查找系列'}), '不存在');
  expect(within(list).getByRole('status').textContent).toContain('没有匹配');
  expect(screen.getByRole('button', {name:'新建系列'})).not.toBeNull();
});

it('accepts at most 200 title characters before creation and exposes the limit', async () => {
  const user = userEvent.setup();
  const account = {id:'account', name:'工作室', slug:'studio', timezone:'Asia/Shanghai', archived_at:null, created_at:'2026-10-28T00:00:00Z', current_blueprint_version_id:'blueprint'};
  render(<EpisodeForm accounts={[account]} series={[]} seriesVersions={[]} isPending={false} onClose={vi.fn()} onSubmit={vi.fn()}/>);
  const title = screen.getByRole('textbox', {name:'工作标题（可留空）'}) as HTMLInputElement;
  await user.type(title, '跨境联合制作内容'.repeat(26));
  expect(title.value.length).toBe(200);
  expect(screen.getByText('200 / 200 字符')).not.toBeNull();
});
