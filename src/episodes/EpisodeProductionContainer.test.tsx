import { act, cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryEpisodeProductionRuntime,
  EpisodeProduction,
  EpisodeProductionRuntimeProvider,
  type EpisodeProductionProps,
  type EpisodeProductionSnapshot,
} from "./EpisodeProductionContainer";

function snapshot(episodeId = "episode-1"): EpisodeProductionSnapshot {
  return {
    artifacts: [],
    audioTrackAnnotations: [],
    audioTracks: [],
    blueprint: null,
    connectionVersions: [],
    episode: {
      account_id: "account-1",
      blueprint_version_id: "blueprint-1",
      created_at: "2026-09-13T00:00:00.000Z",
      id: episodeId,
      is_test: false,
      main_script_revision_id: null,
      series_version_id: null,
      stage: "waiting_input",
      title: "内存生产单",
      updated_at: "2026-09-13T00:00:00.000Z",
    },
    materialRevisions: [],
    preRenderReviewMemberDecisions: [],
    preRenderReviewMembers: [],
    qcReviewIssues: [],
    reviewAnnotations: [],
    reviewPackages: [],
    seriesVersion: null,
    shotPreparationDrafts: [],
    storyboardAudioSelections: [],
    taskRuns: [],
    tasks: [],
    transitions: [],
  };
}

describe("EpisodeProduction container", () => {
  it("对 App 只暴露已确认的五个协作参数", () => {
    const props: EpisodeProductionProps = {
      episodeId: "episode-1",
      onClose: vi.fn(),
      onOpenAccountWorkspace: vi.fn(),
      onSummaryChanged: vi.fn(),
      ownerId: "owner-1",
    };

    expect(Object.keys(props).sort()).toEqual(["episodeId", "onClose", "onOpenAccountWorkspace", "onSummaryChanged", "ownerId"]);
  });

  it("可通过内存适配器加载完整生产工作台，不访问真实 Supabase", async () => {
    const memory = createMemoryEpisodeProductionRuntime({ snapshot: snapshot() });

    render(
      <EpisodeProductionRuntimeProvider runtime={memory.runtime}>
        <EpisodeProduction episodeId="episode-1" onClose={vi.fn()} onOpenAccountWorkspace={vi.fn()} onSummaryChanged={vi.fn()} ownerId="owner-1" />
      </EpisodeProductionRuntimeProvider>,
    );

    expect(await screen.findByText("内存生产单")).toBeTruthy();
  });

  it("内存适配器记录 RPC 与本地路由边界", async () => {
    const memory = createMemoryEpisodeProductionRuntime({ snapshot: snapshot() });

    await memory.runtime.rpc("transition_episode", { p_episode_id: "episode-1", p_to_stage: "script_review" });
    await memory.runtime.request("/_episode-dispatch", { method: "POST" });

    expect(memory.calls.rpcs).toEqual([{ name: "transition_episode", parameters: { p_episode_id: "episode-1", p_to_stage: "script_review" } }]);
    expect(memory.calls.requests).toEqual([{ input: "/_episode-dispatch", init: { method: "POST" } }]);
  });
  it("详情状态变化通知当前页摘要，隐藏时停止请求、恢复可见立即更新", async () => {
    vi.useFakeTimers();
    const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const source = { snapshot: snapshot() };
    source.snapshot.tasks = [{ id: "task-1", episode_id: "episode-1", task_type: "draft_brief", status: "running", input_snapshot: {}, created_at: "2000-01-01" }] as never;
    const memory = createMemoryEpisodeProductionRuntime(source);
    const load = vi.spyOn(memory.runtime, "load");
    const summary = vi.fn();
    try {
      await act(async () => { render(<EpisodeProductionRuntimeProvider runtime={memory.runtime}><EpisodeProduction episodeId="episode-1" onClose={vi.fn()} onOpenAccountWorkspace={vi.fn()} onSummaryChanged={summary} ownerId="owner-1" /></EpisodeProductionRuntimeProvider>); });
      expect(summary).toHaveBeenCalledWith(source.snapshot);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(20000); });
      expect(load).toHaveBeenCalledTimes(1);
      source.snapshot = { ...source.snapshot, episode: { ...source.snapshot.episode, title: "恢复后的状态" }, tasks: [] };
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      expect(load).toHaveBeenCalledTimes(2);
      expect(summary).toHaveBeenLastCalledWith(source.snapshot);
      expect(screen.getByText("恢复后的状态")).toBeTruthy();
    } finally {
      cleanup(); vi.useRealTimers();
      if (visibility) Object.defineProperty(document, "visibilityState", visibility);
      else delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });

});
