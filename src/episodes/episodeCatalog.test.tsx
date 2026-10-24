import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { EpisodeCatalog } from './episodeCatalog';

const remote = vi.hoisted(() => ({
  requests: [] as Array<{ args: Record<string, unknown>; token: string; resolve: (value: unknown) => void }>,
  listener: null as null | ((event: string, session: unknown) => void),
  session: { user: { id: 'owner-1' }, access_token: 'session-one' },
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const query = { order: () => query, range: async () => ({ data: table === 'accounts' ? [{ id: 'account-one', name: '测试账号', slug: 'fixture', current_blueprint_version_id: 'blueprint' }] : table === 'account_blueprint_versions' ? [{ id: 'blueprint', account_id: 'account-one', version: 1, policy: {} }] : [], error: null, count: table === 'accounts' || table === 'account_blueprint_versions' ? 1 : 0 }) };
    return { select: () => query };
  },
  rpc: (_name: string, args: Record<string, unknown>) => _name === 'read_episode_catalog' ? ({ setHeader: (_key: string, authorization: string) => new Promise((resolve) => remote.requests.push({ args, token: authorization, resolve })) }) : ({ range: async () => ({ data: [], count: 0, error: null }) }),
  auth: {
    getSession: async () => ({ data: { session: remote.session }, error: null }),
    onAuthStateChange: (listener: typeof remote.listener) => { remote.listener = listener; return { data: { subscription: { unsubscribe: () => {} } } }; },
  },
} }));
function page(title: string, number = 1, total = 1005): EpisodeCatalog {
  return { episodes: [{ id: `ep-${title}`, title, account_id: 'account-one', stage: 'waiting_input', blueprint_version_id: 'blueprint', updated_at: '2000-01-01' }], page: number, pageSize: 20, total, episodeCount: total, accountCounts: { 'account-one': total }, reviewCount: 36, stages: { waiting_input: total }, artifactCounts: {}, pending: { items: [], page: 1, total: 0 }, blocked: { items: [], page: 1, total: 0 }, worker: { running: 0, blocked: 0, failed: 0, latestCompleted: false }, operationRows: [] } as unknown as EpisodeCatalog;
}
async function answer(index: number, value: EpisodeCatalog) {
  await waitFor(() => expect(remote.requests.length).toBeGreaterThan(index));
  await act(async () => remote.requests[index].resolve({ data: value, error: null }));
}
async function openEpisodes() {
  render(<App />);
  await answer(0, page('运营首条'));
  fireEvent.click((await screen.findAllByRole('button', { name: '生产单' }))[0]);
  await answer(1, page('列表首条'));
}
beforeEach(() => { remote.requests.length = 0; remote.listener = null; vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('server catalog in the real console', () => {
  it('筛选重置到第一页，慢旧页不能覆盖新筛选结果', async () => {
    await openEpisodes();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(remote.requests.length).toBe(3));
    expect(remote.requests[2].args.p_page).toBe(2);
    // Filters stay available during a page request.
    await answer(2, page('第二页', 2));
    fireEvent.change(screen.getByRole('combobox', { name: '账号' }), { target: { value: 'account-one' } });
    await waitFor(() => expect(remote.requests.length).toBe(4));
    expect(remote.requests[3].args).toMatchObject({ p_page: 1, p_account_id: 'account-one' });
    // A second scope change while the first is in flight wins.
    fireEvent.change(screen.getByLabelText('生产单状态'), { target: { value: 'archived' } });
    await waitFor(() => expect(remote.requests.length).toBe(5));
    const archived = page('归档结果', 1, 1); archived.episodes[0].archived_at = '2000-01-02';
    await answer(4, archived);
    await answer(3, page('过期账号结果'));
    expect(screen.getByText('归档结果')).toBeTruthy();
    expect(screen.queryByText('过期账号结果')).toBeNull();
  });
  it('快速切回已加载的筛选仍发新请求，不停留在加载状态', async () => {
    await openEpisodes();
    fireEvent.change(screen.getByRole('combobox', { name: '账号' }), { target: { value: 'account-one' } });
    await waitFor(() => expect(remote.requests.length).toBe(3));
    fireEvent.change(screen.getByRole('combobox', { name: '账号' }), { target: { value: '全部账号' } });
    await waitFor(() => expect(remote.requests.length).toBe(4));
    await answer(3, page('切回的最新页'));
    await answer(2, page('失效筛选页'));
    expect(screen.getByText('切回的最新页')).toBeTruthy();
    expect(screen.queryByText('失效筛选页')).toBeNull();
    expect(screen.queryByText('正在刷新当前页面…')).toBeNull();
  });
  it('重复选择同值筛选也会完成刷新，不遗留被取消请求的加载状态', async () => {
    await openEpisodes();
    fireEvent.change(screen.getByRole('combobox', { name: '账号' }), { target: { value: 'account-one' } });
    await waitFor(() => expect(remote.requests.length).toBe(3));
    fireEvent.change(screen.getByRole('combobox', { name: '账号' }), { target: { value: 'account-one' } });
    await waitFor(() => expect(remote.requests.length).toBe(4));
    await answer(3, page('同值刷新结果'));
    await answer(2, page('旧请求结果'));
    expect(screen.getByText('同值刷新结果')).toBeTruthy();
    expect(screen.queryByText('正在刷新当前页面…')).toBeNull();
  });
  it('远端阻塞项打开蓝图修复后保留上下文，不把未加载的任务当作解除阻塞', async () => {
    render(<App />);
    const catalog = page('修复生产单');
    catalog.blocked = { page: 1, total: 1, items: [{ episode: catalog.episodes[0], blocker: { code: 'fixture_configuration', detail: '补齐模型配置', taskId: 'task-1', action: 'edit_blueprint', scope: 'blueprint', capability: 'a_roll_generation' } }] };
    await answer(0, catalog);
    fireEvent.click(await screen.findByRole('button', { name: '修改配置并继续当前生产单' }));
    await waitFor(() => expect(screen.queryByText('当前生产单的阻塞已解除，已返回生产单详情。')).toBeNull());
    expect(screen.getByRole('button', { name: '保存并继续当前生产单' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '生产单详情' })).toBeNull();
  });
  it('退出登录后拒绝在途列表及旧会话的回填', async () => {
    await openEpisodes();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(remote.requests.length).toBe(3));
    expect(remote.requests[2].token).toBe('Bearer session-one');
    await act(async () => remote.listener?.('SIGNED_OUT', null));
    await answer(2, page('禁止回填', 2));
    expect(screen.getByRole('heading', { name: '登录控制台' })).toBeTruthy();
    expect(screen.queryByText('禁止回填')).toBeNull();
  });
});
