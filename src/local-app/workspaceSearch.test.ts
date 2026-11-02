// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { parseWorkspaceSearch, readWorkspaceSearch } from './workspaceSearch';

describe('workspace search query boundary', () => {
  it('trims a bounded query and treats percent, underscore and SQL punctuation as literal search text', () => {
    expect(parseWorkspaceSearch(new URLSearchParams({ q: '  主脚本  ' }))).toBe('主脚本');
    expect(parseWorkspaceSearch(new URLSearchParams({ q: "%_' OR true --" }))).toBe("%_' OR true --");
    expect(parseWorkspaceSearch(new URLSearchParams({ q: 'x'.repeat(200) }))).toHaveLength(200);
    expect(parseWorkspaceSearch(new URLSearchParams({q:'作品',category:'materials',page:'2'}))).toBe('作品');
  });

  it.each(['', 'q=', 'q=+++', 'q=a&q=b', 'q=a&ownerId=foreign', 'q=a&category=secret', 'q=a&category=materials&category=accounts', 'q=a&page=0', 'q=a&page=1.2', 'q=a&page=1000000', 'q=%00bad', 'q=%0Abad', 'q=%7Fbad', `q=${'x'.repeat(201)}`])('rejects invalid or ambiguous query %s before opening a transaction', async raw => {
    const connect = vi.fn();
    await expect(readWorkspaceSearch({ connect } as unknown as Pool, 'owner', new URLSearchParams(raw))).rejects.toMatchObject({ status: 400 });
    expect(connect).not.toHaveBeenCalled();
  });
});
