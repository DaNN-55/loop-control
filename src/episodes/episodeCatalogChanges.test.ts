import { describe, expect, it } from 'vitest';
import { episodeCatalogChanged } from './episodeCatalog';
import type { EpisodeProductionSnapshot } from './EpisodeProductionContainer';
import { vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
const episode = { id: 'episode-one', stage: 'waiting_input' };
const before = { episode, tasks: [{ id: 'task-one', status: 'ready', task_type: 'draft_brief', created_at: '2000-01-01', input_snapshot: {}, last_result: {} }], taskRuns: [], artifacts: [], reviewPackages: [], preRenderReviewMembers: [], preRenderReviewMemberDecisions: [] } as unknown as EpisodeProductionSnapshot;
describe('catalog updates from detail state', () => {
  it('无变化的执行记录补丁或租约心跳不重复刷新目录', () => {
    const next = structuredClone(before); next.episode = before.episode;
    next.tasks[0].claimed_at = '2000-01-02';
    expect(episodeCatalogChanged(before, next)).toBe(false);
    next.taskRuns = [{ id: 'run-one', status: 'running' }] as never;
    expect(episodeCatalogChanged(before, next)).toBe(false);
  });
  it('任务状态变化刷新当前页及全局 Worker 状态', () => {
    const next = { ...before, tasks: [{ ...before.tasks[0], status: 'completed' as const }] };
    expect(episodeCatalogChanged(before, next)).toBe(true);
  });
  it('仅新增产物也刷新目录中的产物数', () => {
    expect(episodeCatalogChanged(before, { ...before, artifacts: [{ id: 'artifact-one' }] as never })).toBe(true);
  });
  it('仅审核包或成员决定变化也刷新运营待审摘要', () => {
    expect(episodeCatalogChanged(before, { ...before, reviewPackages: [{ id: 'review-one' }] as never })).toBe(true);
    expect(episodeCatalogChanged(before, { ...before, preRenderReviewMemberDecisions: [{ review_package_id: 'review-one', member_key: 'shot-one' }] as never })).toBe(true);
  });
});
