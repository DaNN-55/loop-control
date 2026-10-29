import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EpisodeVideoBudget, WanShotGenerator } from "./WanShotGenerator";
import type { Database } from "../lib/database.types";
const mocks = vi.hoisted(() => ({ command: vi.fn(), request: vi.fn().mockResolvedValue({budget:null,usedCents:0}) }));
vi.mock("../local-app/client", () => ({ localCommand: mocks.command, localRequest: mocks.request }));
const props = { episodeId: "episode", reviewPackageId: "review", shot: { id: "shot-01", shotType: "a_roll", productionMethod: "轻微转身" }, materials: [{ id: "image", material_type: "image", source_path: "男主.png" }] as Database["public"]["Tables"]["production_material_revisions"]["Row"][], tasks: [], onRefresh: vi.fn().mockResolvedValue(undefined) };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
describe("Wan shot generation", () => {
  beforeEach(() => {
    mocks.command.mockReset();
    mocks.command.mockResolvedValue({});
    mocks.request.mockReset();
    mocks.request.mockResolvedValue({ budget: null, usedCents: 0 });
  });

  it("人工路径不出现生成入口", () => { render(<WanShotGenerator {...props} blueprint={{ a_roll: { execution_path: "manual" } }} />); expect(screen.queryByText("生成 AI 视频")).toBeNull(); });
  it("Episode 级预算只渲染一次，多镜头生成器不重复预算表单", async () => {
    const blueprint = {
      a_roll: { execution_path: "external", executor: { provider: "bailian" } },
      b_roll: { execution_path: "external", executor: { provider: "bailian" } },
    };
    render(<>
      <EpisodeVideoBudget episodeId="episode" blueprint={blueprint} shots={[{ shotType: "a_roll" }, { shotType: "b_roll" }]} />
      <WanShotGenerator {...props} blueprint={blueprint} showBudget={false} />
      <WanShotGenerator {...props} shot={{ ...props.shot, id: "shot-02", shotType: "b_roll" }} blueprint={blueprint} showBudget={false} />
    </>);
    await waitFor(() => expect(screen.getByText(/^生成预算/)).toBeTruthy());
    expect(screen.getAllByText(/^生成预算/)).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "生成 AI 视频" })).toHaveLength(2);
    expect(screen.queryByLabelText("shot-01 试片预算")).toBeNull();
  });
  it("任务状态刷新只更新预算摘要，不覆盖正在编辑的额度", async () => {
    const blueprint = { a_roll: { execution_path: "external", executor: { provider: "bailian" } } };
    mocks.request
      .mockResolvedValueOnce({ budget: { trial_video_limit_cents: 350, total_limit_cents: 2500, full_generation_enabled: true }, usedCents: 75 })
      .mockResolvedValueOnce({ budget: { trial_video_limit_cents: 350, total_limit_cents: 2500, full_generation_enabled: true }, usedCents: 125 });
    const user = userEvent.setup();
    const { rerender } = render(<EpisodeVideoBudget episodeId="episode" blueprint={blueprint} shots={[{ shotType: "a_roll" }]} tasks={[]} />);
    await user.click(screen.getByText(/^生成预算/));
    await waitFor(() => expect((screen.getByLabelText("视频 试片预算") as HTMLInputElement).value).toBe("3.5"));
    await user.clear(screen.getByLabelText("视频 试片预算"));
    await user.type(screen.getByLabelText("视频 试片预算"), "7");
    await user.clear(screen.getByLabelText("视频 总预算"));
    await user.type(screen.getByLabelText("视频 总预算"), "30");
    rerender(<EpisodeVideoBudget episodeId="episode" blueprint={blueprint} shots={[{ shotType: "a_roll" }]} tasks={[{ id: "task-1", status: "running", actual_cost_cents: null } as Database["public"]["Tables"]["tasks"]["Row"]]} />);
    await waitFor(() => expect(screen.getByText(/¥1\.25/)).toBeTruthy());
    expect((screen.getByLabelText("视频 试片预算") as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText("视频 总预算") as HTMLInputElement).value).toBe("30");
  });
  it("保存延迟期间切换 Episode 不会读取或覆盖新期预算", async () => {
    const blueprint = { a_roll: { execution_path: "external", executor: { provider: "bailian" } } };
    const save = deferred<unknown>();
    mocks.request.mockResolvedValue({ budget: { trial_video_limit_cents: 350, total_limit_cents: 2500, full_generation_enabled: true }, usedCents: 75 });
    mocks.command.mockReturnValue(save.promise);
    const user = userEvent.setup();
    const { rerender } = render(<EpisodeVideoBudget episodeId="episode" blueprint={blueprint} shots={[{ shotType: "a_roll" }]} />);
    await user.click(screen.getByText(/^生成预算/));
    await waitFor(() => expect((screen.getByLabelText("视频 试片预算") as HTMLInputElement).value).toBe("3.5"));
    const oldRequestCount = mocks.request.mock.calls.filter(([url]) => url === "wan-budget?episode=episode").length;
    await user.click(screen.getByText("保存生成预算"));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith("setWanBudget", expect.anything(), undefined, "episode-commands"));
    mocks.request.mockResolvedValue({ budget: { trial_video_limit_cents: 450, total_limit_cents: 3000, full_generation_enabled: false }, usedCents: 200 });
    rerender(<EpisodeVideoBudget episodeId="next-episode" blueprint={blueprint} shots={[{ shotType: "a_roll" }]} />);
    await waitFor(() => expect((screen.getByLabelText("视频 试片预算") as HTMLInputElement).value).toBe("4.5"));
    save.resolve({});
    await waitFor(() => expect(mocks.request.mock.calls.filter(([url]) => url === "wan-budget?episode=episode")).toHaveLength(oldRequestCount));
    expect((screen.getByLabelText("视频 试片预算") as HTMLInputElement).value).toBe("4.5");
  });
  it("卸载旧 Episode 后，延迟的旧预算响应不影响新页面", async () => {
    const blueprint = { a_roll: { execution_path: "external", executor: { provider: "bailian" } } };
    const oldRead = deferred<unknown>();
    mocks.request.mockImplementation((url: string) => url === "wan-budget?episode=old-episode"
      ? oldRead.promise
      : Promise.resolve({ budget: { trial_video_limit_cents: 550, total_limit_cents: 3500, full_generation_enabled: false }, usedCents: 300 }));
    const oldPage = render(<EpisodeVideoBudget episodeId="old-episode" blueprint={blueprint} shots={[{ shotType: "a_roll" }]} />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("wan-budget?episode=old-episode"));
    oldPage.unmount();
    render(<EpisodeVideoBudget episodeId="new-episode" blueprint={blueprint} shots={[{ shotType: "a_roll" }]} />);
    await userEvent.setup().click(screen.getByText(/^生成预算/));
    await waitFor(() => expect((screen.getByLabelText("视频 试片预算") as HTMLInputElement).value).toBe("5.5"));
    oldRead.resolve({ budget: { trial_video_limit_cents: 99, total_limit_cents: 99, full_generation_enabled: true }, usedCents: 999 });
    await Promise.resolve();
    expect((screen.getByLabelText("视频 试片预算") as HTMLInputElement).value).toBe("5.5");
  });
  it("没有 external 视频供应商时不显示 Episode 预算", () => {
    render(<EpisodeVideoBudget episodeId="episode" blueprint={{ a_roll: { execution_path: "manual" } }} shots={[{ shotType: "a_roll" }]} />);
    expect(screen.queryByText(/^生成预算/)).toBeNull();
  });
  it("读取已有预算作为编辑值，保存时保留实际额度和继续生成授权", async () => {
    mocks.request.mockResolvedValueOnce({budget:{trial_video_limit_cents:350,total_limit_cents:2500,full_generation_enabled:true},usedCents:75});
    const user = userEvent.setup(); mocks.command.mockResolvedValue({});
    render(<WanShotGenerator {...props} blueprint={{a_roll:{execution_path:"external",executor:{provider:"bailian"}}}} />);
    await user.click(screen.getByText(/^生成预算/));
    await waitFor(()=>expect((screen.getByLabelText("shot-01 试片预算") as HTMLInputElement).value).toBe("3.5"));
    expect((screen.getByLabelText("shot-01 总预算") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("允许在试片后继续生成") as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByText("保存生成预算"));
    expect(mocks.command).toHaveBeenCalledWith("setWanBudget",{episodeId:"episode",trialCents:350,totalCents:2500,full:true},undefined,"episode-commands");
    mocks.command.mockClear();
  });
  it.each(["a_roll", "b_roll"])("%s显式选首帧后才能创建任务，不自动消费", async (kind) => {
    const user = userEvent.setup(); mocks.command.mockResolvedValue({ id: "task" });
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 202 })); vi.stubGlobal("fetch", fetcher);
    render(<WanShotGenerator {...props} shot={{ ...props.shot, shotType: kind }} blueprint={{ [kind]: { execution_path: "external", executor: { provider: "bailian" } } }} />);
    expect(mocks.command).not.toHaveBeenCalled();
    expect((screen.getByRole("button", {name:"生成 AI 视频"}) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText("shot-01 AI 首帧"), "image"); await user.click(screen.getByText("生成 AI 视频"));
    expect(mocks.command).toHaveBeenCalledWith("generateWan", expect.objectContaining({ firstFrameId: "image", durationSeconds: 5, shotId: "shot-01" }), undefined, "episode-commands");
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals(); mocks.command.mockClear();
  });
});
it.each([['volcengine','doubao-seedance-2-0-260128'],['volcengine','doubao-seedance-2-5-260628'],['minimax','MiniMax-H3'],['kling','kling-v3']])('%s %s requires an explicit per-request reservation before generating',async(provider,model)=>{
 const user=userEvent.setup();mocks.command.mockClear();mocks.command.mockResolvedValue({id:'official-task'});
 render(<WanShotGenerator {...props} materials={[{...props.materials[0],mime_type:'image/png'}]} blueprint={{a_roll:{execution_path:'external',executor:{provider,model}}}}/>);
 await user.selectOptions(screen.getByLabelText('shot-01 AI 首帧'),'image');expect((screen.getByRole('button', {name:'生成 AI 视频'}) as HTMLButtonElement).disabled).toBe(true);expect(mocks.command).not.toHaveBeenCalled();
 await user.type(screen.getByLabelText('shot-01 本次费用预留'),'1.23');await user.click(screen.getByText('生成 AI 视频'));
 expect(mocks.command).toHaveBeenCalledWith('generateOfficialVideo',expect.objectContaining({reservationCents:123,durationSeconds:5,firstFrameId:'image'}),undefined,'episode-commands');
});
