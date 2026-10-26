import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WanShotGenerator } from "./WanShotGenerator";
import type { Database } from "../lib/database.types";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: mocks.session } } }));
const props = { episodeId: "episode", reviewPackageId: "review", shot: { id: "shot-01", shotType: "a_roll", productionMethod: "轻微转身" }, materials: [{ id: "image", material_type: "image", source_path: "男主.png" }] as Database["public"]["Tables"]["production_material_revisions"]["Row"][], tasks: [], onRefresh: vi.fn().mockResolvedValue(undefined) };
describe("Wan shot generation", () => {
  it("人工路径不出现生成入口", () => { render(<WanShotGenerator {...props} blueprint={{ a_roll: { execution_path: "manual" } }} />); expect(screen.queryByText("生成 AI 视频")).toBeNull(); });
  it.each(["a_roll", "b_roll"])("%s显式选首帧后才能创建任务，不自动消费", async (kind) => {
    const user = userEvent.setup(); mocks.rpc.mockResolvedValue({ data: "task", error: null }); mocks.session.mockResolvedValue({ data: { session: { access_token: "test-session" } }, error: null });
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 202 })); vi.stubGlobal("fetch", fetcher);
    render(<WanShotGenerator {...props} shot={{ ...props.shot, shotType: kind }} blueprint={{ [kind]: { execution_path: "external", executor: { provider: "bailian" } } }} />);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((screen.getByText("生成 AI 视频") as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText("shot-01 AI 首帧"), "image"); await user.click(screen.getByText("生成 AI 视频"));
    expect(mocks.rpc).toHaveBeenCalledWith("request_wan_shot_video", expect.objectContaining({ p_first_frame_id: "image", p_duration: 5, p_shot_id: "shot-01" }));
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("task=task"), expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals(); mocks.rpc.mockClear();
  });
});
