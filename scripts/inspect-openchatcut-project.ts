import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const [projectPath, configuredRoot] = process.argv.slice(2);
if (!projectPath || !configuredRoot) throw new Error("Usage: inspect-openchatcut-project <project.json> <openchatcut-root>");

const root = resolve(configuredRoot);
const load = (relativePath: string) => import(pathToFileURL(join(root, relativePath)).href);
const [{ migrateProjectDoc }, { captionsOnTrack, timelineTrackIds, trackKind }, { resolveCaptionWords }, { isManualCaptionEntry, updateManualCue }, { reduce }] = await Promise.all([
  load("src/persist/projectStore.ts"),
  load("src/editor/types.ts"),
  load("src/captions/resolve.ts"),
  load("src/captions/manualCaptions.ts"),
  load("src/editor/reducerTimeline.ts"),
]);

const source = JSON.parse(await readFile(resolve(projectPath), "utf8"));
const project = migrateProjectDoc(source);
if (!project) {
  process.stdout.write(JSON.stringify({ readable: false, captionTracks: [], textItemsOnCaptionTracks: 0, audioTracks: [], audibleVideoItems: [], videoLayers: [], assets: [] }));
  process.exit(0);
}

const timeline = project.timelines.find((candidate: { id: string }) => candidate.id === project.activeTimelineId) ?? project.timelines[0];
const captionTrackIds = timelineTrackIds(timeline).filter((id: string) => trackKind(timeline, id) === "caption");
const { trackAlias } = await load("src/editor/types.ts");
const audioTrackIds = timelineTrackIds(timeline).filter((id: string) => trackKind(timeline, id) === "audio");
const captionTracks = captionTrackIds.map((id: string) => {
  const captions = captionsOnTrack(timeline, id);
  const lanes = captions?.sourceEntries?.filter(isManualCaptionEntry) ?? [];
  let edited = captions;
  const probeIds = new Set<string>();
  for (const lane of lanes) {
    const cue = lane.words?.[0];
    if (!cue || !edited) continue;
    const probeText = `__loop_control_edit_probe_${lane.id}__`;
    const patch = updateManualCue(edited, lane.id, 0, probeText, cue.start, cue.end);
    if (patch) { edited = { ...edited, ...patch }; probeIds.add(probeText); }
  }
  const editedCues = edited ? resolveCaptionWords(edited, timeline.items, timeline.fps) : [];
  const slots = captions?.layoutPolicy?.mode === 'manual-slots' ? captions.layoutPolicy.slots : [];
  return {
    id,
    enabled: captions?.enabled === true,
    editable: probeIds.size > 0 && [...probeIds].every((probeText) => editedCues.some((editedCue: { text: string }) => editedCue.text === probeText)),
    cues: captions ? resolveCaptionWords(captions, timeline.items, timeline.fps).map((cue: { id?: string; text: string; start: number; end: number }) => ({ id: cue.id, text: cue.text, start: cue.start, end: cue.end })) : [],
    constraints: lanes.map((lane) => {
      const slot = slots.find((candidate: { id: string }) => candidate.id === lane.slotId);
      const perSource = captions?.perSource?.[lane.id] as { maxLines?: number; maxCharactersPerLine?: number } | undefined;
      return { sourceId: lane.id, anchor: slot?.anchor ?? lane.anchor ?? captions?.layout?.anchor, offsetXRatio: slot?.offsetXRatio ?? lane.offsetXRatio, offsetYRatio: slot?.offsetYRatio ?? lane.offsetYRatio, safeWidthRatio: slot?.widthRatio ?? lane.widthRatio, safeHeightRatio: slot?.heightRatio ?? lane.heightRatio, maxLines: perSource?.maxLines, maxCharactersPerLine: perSource?.maxCharactersPerLine ?? lane.maxCharactersPerLine };
    }),
  };
});
process.stdout.write(JSON.stringify({
  readable: true,
  activeTimelineId: timeline.id,
  captionTracks,
  textItemsOnCaptionTracks: timeline.items.filter((item: { kind: string; track: string }) => item.kind === "text" && captionTrackIds.includes(item.track)).length,
  audioTracks: audioTrackIds.map((id: string) => ({ id, alias: trackAlias(timeline, id), role: timeline.tracks[id]?.role, duckDepthDb: timeline.tracks[id]?.audioRouting?.duckDepthDb, items: timeline.items.filter((item: { kind: string; track: string }) => item.kind === "audio" && item.track === id).map((item: { id: string; src?: string; sourceAssetId?: string; startFrame: number; durationInFrames: number; srcInFrame?: number; volume?: number }) => ({ id: item.id, src: item.src, sourceAssetId: item.sourceAssetId, startFrame: item.startFrame, durationInFrames: item.durationInFrames, srcInFrame: item.srcInFrame, volume: item.volume ?? 1 })) })),
  audibleVideoItems: timeline.items.filter((item: { kind: string; volume?: number }) => item.kind === "video" && (item.volume ?? 1) > 0).map((item: { id: string; track: string; volume?: number }) => ({ id: item.id, track: item.track, volume: item.volume ?? 1 })),
  videoLayers: timeline.items.filter((item: { kind: string }) => item.kind === "video").map((item: { id: string; track: string; startFrame: number; durationInFrames: number; sourceAssetId?: string; transform?: Record<string, unknown> }) => {
    const nextX = Number(item.transform?.x ?? 0) + 0.001;
    const edited = reduce(timeline, { type: "setTransform", id: item.id, patch: { x: nextX } });
    const editedItem = edited.items.find((candidate: { id: string }) => candidate.id === item.id);
    return { id: item.id, track: item.track, alias: trackAlias(timeline, item.track), startFrame: item.startFrame, durationInFrames: item.durationInFrames, sourceAssetId: item.sourceAssetId, transform: item.transform, editable: editedItem?.transform?.x === nextX };
  }),
  assets: project.assets.map((asset: { id: string; src: string }) => ({ id: asset.id, src: asset.src })),
}));
