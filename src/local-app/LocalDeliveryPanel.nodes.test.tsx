import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalDeliveryPanel } from './LocalDeliveryPanel';
import type { EpisodeProductionSnapshot } from '../episodes/EpisodeProductionContainer';
vi.mock('../lib/viewTransport', () => ({ viewTransport: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) } } }));
afterEach(cleanup);
function snapshot(stage: string) { return { episode: { id: 'episode', stage }, reviewPackages: [{ id: 'qc', stage: 'qc_review', revision_number: 1, context_snapshot: {}, invalidated_at: null }], tasks: [{ id: 'final', task_type: 'generate_final_render', status: 'blocked' }], qcReviewIssues: [{ id: 'issue', review_package_id: 'qc', at_seconds: 4, severity: 'blocking', reason: '字幕未对齐', status: 'open' }], preRenderReviewMembers: [], artifacts: [] } as unknown as EpisodeProductionSnapshot; }
const props = { pending: false, onRefresh: vi.fn(), onDeleted: vi.fn() };
it('allows resolving issues only in the real current QC stage', async () => {
    const command = vi.fn().mockResolvedValue({});
    render(<LocalDeliveryPanel {...props} view="qc" snapshot={snapshot('qc_review')} command={command}/>);
    expect(screen.queryByRole('button', { name: '重试最终成片' })).toBeNull();
    await userEvent.setup().click(screen.getByText('字幕未对齐'));
    await userEvent.setup().click(screen.getByRole('button', { name: '确认已处理' }));
    expect(command).toHaveBeenCalledWith('resolveQcIssue', { episodeId: 'episode', reviewPackageId: 'qc', issueId: 'issue', status: 'accepted' });
});
it('keeps completed QC evidence visible without mutation controls', () => {
    const command = vi.fn();
    render(<LocalDeliveryPanel {...props} view="qc" snapshot={snapshot('production_completed')} command={command}/>);
    expect(screen.getByText('字幕未对齐')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认已处理' })).toBeNull();
    expect(screen.queryByRole('button', { name: '忽略问题' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重试最终成片' })).toBeNull();
    expect(screen.queryByRole('button', { name: '记录 QC 问题' })).toBeNull();
    expect(command).not.toHaveBeenCalled();
});
it('retains the existing final-render retry payload after QC approval', async () => {
    const command = vi.fn().mockResolvedValue({});
    render(<LocalDeliveryPanel {...props} view="qc" snapshot={snapshot('qc_passed')} command={command}/>);
    await userEvent.setup().click(screen.getByText('最终成片恢复'));
    const field = screen.getByRole('textbox', { name: '最终成片重试原因' });
    fireEvent.change(field, { target: { value: '已恢复输入文件' } });
    await userEvent.setup().click(screen.getByRole('button', { name: '重试最终成片' }));
    expect(command).toHaveBeenCalledWith('retryFinalRender', { episodeId: 'episode', reviewPackageId: 'qc', reason: '已恢复输入文件' });
    expect(screen.queryByRole('button', { name: '确认已处理' })).toBeNull();
});
