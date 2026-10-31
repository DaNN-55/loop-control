// @vitest-environment node
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { patchCaptionCueIdentity } from './openchatcut-caption-identity.mjs';

const root = process.env.OPENCHATCUT_ROOT;
if (!root) throw Error('Caption identity integration requires OPENCHATCUT_ROOT.');
let sdk;
let dom;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'localStorage']) vi.stubGlobal(key, dom.window[key]);
  dom.window.PointerEvent = dom.window.MouseEvent;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const bundled = await build({
    stdin: { contents: `export {CaptionTrackLane} from ${JSON.stringify(join(root, 'src/captions/CaptionTrackLane.tsx'))};`, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-dom'],
    plugins: [{ name: 'actual-caption-identity-adapter', setup(b) {
      b.onLoad({ filter: /(?:CaptionTrackLane\.tsx|useCaptionCueGestures\.ts)$/ }, async ({ path }) => ({ contents: patchCaptionCueIdentity(await readFile(path, 'utf8'), path), loader: path.endsWith('tsx') ? 'tsx' : 'ts' }));
    } }],
  });
  const output = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  sdk = output.exports;
});
afterEach(cleanup);
afterAll(() => { dom?.window.close(); vi.unstubAllGlobals(); });

function fixture() {
  return { enabled: true, template: 'plain', pacing: 'phrase', sourceEntries: [
    { id: 'shot-one', itemId: 'manual:shot-one', trackOrder: 0, words: [{ id: 'phrase-1', text: 'first shot', start: 0, end: 1000 }] },
    { id: 'shot-two', itemId: 'manual:shot-two', trackOrder: 1, words: [{ id: 'phrase-1', text: 'second shot', start: 1200, end: 2000 }] },
  ] };
}
function mount(captions = fixture(), locked = false) {
  const onSelectCaption = vi.fn(), onDelete = vi.fn(), onUpdate = vi.fn(), onMove = vi.fn(), onMoveTimelineSelection = vi.fn();
  const view = render(createElement(sdk.CaptionTrackLane, {
    state: { items: [], fps: 30, tracks: { caption: { kind: 'caption', captions } }, trackOrder: ['caption'] }, captions,
    trackId: 'caption', playheadFrame: 0, px: 4, rowHeight: 40, hidden: false,
    locked, snapping: false, trackFromClientY: () => 'caption',
    onSelectCaption, onDelete, onUpdate, onMoveTimelineSelection, onMove,
  }));
  return { ...view, onSelectCaption, onDelete, onUpdate, onMove, onMoveTimelineSelection };
}
it('selects each actual SDK cue in its owning lane when IDs repeat', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const view = mount();
    for (const [text, laneId] of [['first shot', 'shot-one'], ['second shot', 'shot-two']]) {
      fireEvent.pointerDown(view.getByText(text).parentElement!, { button: 0, ctrlKey: true });
      expect(view.onSelectCaption).toHaveBeenLastCalledWith({ trackId: 'caption', kind: 'manual', laneId, cueId: 'phrase-1' }, expect.any(Object));
    }
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  } finally { error.mockRestore(); }
});
it('deletes only the selected SDK cue and preserves its sibling lane', () => {
  const captions = fixture(), original = structuredClone(captions), view = mount(captions);
  fireEvent.keyDown(view.getByText('first shot').parentElement!, { key: 'Delete' });
  expect(view.onDelete).toHaveBeenCalledExactlyOnceWith('shot-one', 0);
  expect(captions).toEqual(original);
});
it('trims the first cue through the SDK handle without changing its sibling', () => {
  const captions = fixture(), view = mount(captions);
  const endHandle = view.getByText('first shot').parentElement!.querySelector('.right')!;
  fireEvent.keyDown(endHandle, { key: 'ArrowLeft' });
  expect(view.onUpdate).toHaveBeenCalledOnce();
  const next = view.onUpdate.mock.calls[0][0];
  expect(next.sourceEntries[0].words[0].end).toBe(Math.round(1000 - 1000 / 30));
  expect(next.sourceEntries[1]).toEqual(captions.sourceEntries[1]);
});
it('preserves the SDK locked track selection and trim guard', () => {
  const view = mount(fixture(), true);
  fireEvent.pointerDown(view.getByText('first shot').parentElement!, { button: 0, ctrlKey: true });
  expect(view.onSelectCaption).not.toHaveBeenCalled();
  expect(view.queryAllByRole('separator')).toHaveLength(0);
  expect(view.onUpdate).not.toHaveBeenCalled();
});
it('drags the first SDK cue with a lane-qualified selection', () => {
  const view = mount();
  fireEvent.pointerDown(view.getByText('first shot').parentElement!, { button: 0, clientX: 50 });
  fireEvent.pointerMove(window, { clientX: 54 });
  fireEvent.pointerUp(window, { clientX: 54 });
  expect(view.onMove).toHaveBeenCalledExactlyOnceWith({ laneId: 'shot-one', index: 0, text: 'first shot', startMs: 1000 / 30, endMs: 1000 + 1000 / 30, targetTrackId: 'caption' });
  expect(view.onMoveTimelineSelection).not.toHaveBeenCalled();
});
it('rejects unsupported SDK edit points instead of silently using cue-only identity', () => {
  expect(() => patchCaptionCueIdentity('unknown', '/src/captions/CaptionTrackLane.tsx')).toThrow('字幕跨轨道定位接点');
  expect(() => patchCaptionCueIdentity('unknown', '/src/captions/useCaptionCueGestures.ts')).toThrow('字幕跨轨道定位接点');
});
