/** Preserve the SDK's lane-local cue identity in its embedded timeline UI. */
export function patchCaptionCueIdentity(code, path) {
  const replacements = path.endsWith('/useCaptionCueGestures.ts')
    ? [["targets.set(word.id, { laneId: entry.id, index, words })", "targets.set(JSON.stringify([entry.id, word.id]), { laneId: entry.id, index, words })"]]
    : path.endsWith('/CaptionTrackLane.tsx')
      ? [
          ["import { captionPages } from './exportCaptions';", "import { buildCaptionPages } from './captionPages';"],
          ['captions ? captionPages(captions, state.items, state.fps) : []', 'captions ? buildCaptionPages(captions, state.items, state.fps) : []'],
          ['pages.map((page, index) => {', 'pages.map(({page, laneId}, index) => {'],
          ['targets.get(page.words[0].id)', 'targets.get(JSON.stringify([laneId, page.words[0].id]))'],
        ]
      : [];
  for (const [before, after] of replacements) {
    if (code.split(before).length !== 2) throw Error('当前 Studio 缺少字幕跨轨道定位接点。');
    code = code.replace(before, after);
  }
  return code;
}
