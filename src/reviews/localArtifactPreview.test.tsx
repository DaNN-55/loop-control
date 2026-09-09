import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("../lib/supabase", () => ({ supabase: { auth: { getSession: mocks.getSession } } }));

import { clearLocalArtifactCache, localArtifactThumbnailUrl, useLocalArtifactBlob, useLocalArtifactText } from "./localArtifactPreview";

function Preview({ source }: { source: string }) {
  const { url } = useLocalArtifactBlob(source);
  return <output>{url}</output>;
}

function PreviewWithText({ source }: { source: string }) {
  const { url } = useLocalArtifactBlob(source);
  const { content } = useLocalArtifactText(`${source}&text=1`);
  return <output>{url}{content}</output>;
}

describe("本地产物预览", () => {
  beforeEach(() => {
    clearLocalArtifactCache();
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "owner-token" } }, error: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ url: "/_local-artifact?ticket=preview" }), ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("在 StrictMode 下合并同一产物的并发读取", async () => {
    const view = render(<StrictMode><Preview source="/_local-artifact?episode=episode-1&path=preview.mp4" /></StrictMode>);

    await waitFor(() => expect(screen.getByText("/_local-artifact?ticket=preview")).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "POST" }));
    view.unmount();
  });

  it("为视频关键帧沿用本地产物鉴权入口", () => {
    expect(localArtifactThumbnailUrl("episode-1", "episodes/episode-1/materials/clip.mp4", "a".repeat(64))).toBe("/_local-artifact?episode=episode-1&path=episodes%2Fepisode-1%2Fmaterials%2Fclip.mp4&sha256=" + "a".repeat(64) + "&thumbnail=keyframe");
  });

  it("重新挂载时复用已经加载的预览 ticket 和文本", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === "POST"
      ? { json: async () => ({ url: "/_local-artifact?ticket=cached" }), ok: true }
      : { ok: true, text: async () => "storyboard" })));
    const source = "/_local-artifact?episode=episode-cache&path=storyboard.json&sha256=immutable";

    const first = render(<PreviewWithText source={source} />);
    await waitFor(() => expect(screen.getByText("/_local-artifact?ticket=cachedstoryboard")).toBeTruthy());
    first.unmount();
    render(<PreviewWithText source={source} />);
    await waitFor(() => expect(screen.getByText("/_local-artifact?ticket=cachedstoryboard")).toBeTruthy());

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
