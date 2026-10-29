import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Database } from "../lib/database.types";
import { ProductionCompletionModal } from "./ProductionCompletionModal";

const episode = { account_id: "account-1", blueprint_version_id: "blueprint-1", created_at: "2026-09-12T00:00:00.000Z", id: "episode-1", stage: "production_completed", title: "已完成生产单", updated_at: "2026-09-12T00:00:00.000Z" } satisfies Database["public"]["Tables"]["episodes"]["Row"];
const artifacts = [
  { artifact_type: "final_render", episode_id: episode.id, file_size: 1200, id: "artifact-video", relative_path: "episodes/episode-1/final-render/final.mp4", sha256: "a".repeat(64) },
  { artifact_type: "cover", episode_id: episode.id, file_size: 80, id: "artifact-cover", relative_path: "episodes/episode-1/publish/cover.png", sha256: "b".repeat(64) },
  { artifact_type: "metadata", episode_id: episode.id, file_size: 100, id: "artifact-metadata", relative_path: "episodes/episode-1/publish/metadata.json", sha256: "c".repeat(64) },
  { artifact_type: "publish_package", episode_id: episode.id, file_size: 220, id: "artifact-package", relative_path: "episodes/episode-1/publish-package/manifest.json", sha256: "d".repeat(64) },
] as Database["public"]["Tables"]["artifacts"]["Row"][];

afterEach(cleanup);

describe("生产完成弹窗", () => {
  it("展示最终材料和生产完成状态，不提供外部发布登记", () => {
    render(<ProductionCompletionModal artifacts={artifacts} episode={episode} isPreparationPending={false} onClose={vi.fn()} onOpenArtifact={vi.fn()} onPrepare={vi.fn()} publishVerification />);
    expect(screen.getByRole("dialog", { name: "完成生产" })).toBeTruthy();
    expect(screen.getByText("生产已完成")).toBeTruthy();
    expect(screen.getByText(/外部发布不在本工作台记录/)).toBeTruthy();
    expect(screen.queryByLabelText("目标平台")).toBeNull();
  });
});


it("inline future delivery stays read-only and never submits", async () => {
 const onPrepare=vi.fn();render(<ProductionCompletionModal inline isReadOnly artifacts={[]} episode={{...episode,stage:"qc_review"}} isPreparationPending={false} onClose={vi.fn()} onOpenArtifact={vi.fn()} onPrepare={onPrepare} publishVerification={false}/>);
 expect(screen.queryByRole("dialog")).toBeNull();expect((screen.getByRole("textbox",{name:"发布标题"}) as HTMLInputElement).matches(":disabled")).toBe(true);
 fireEvent.submit(screen.getByRole("button",{name:"生成发布包并完成生产"}).closest("form")!);expect(onPrepare).not.toHaveBeenCalled();
});

it("inline delivery submits existing real payload once and exposes preparation failures", async () => {
 let finish:(value:boolean)=>void=()=>{};const onPrepare=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
 render(<ProductionCompletionModal inline artifacts={[]} episode={{...episode,stage:"qc_passed"}} isPreparationPending={false} onClose={vi.fn()} onOpenArtifact={vi.fn()} onPrepare={onPrepare} publishVerification={false}/>);
 const user=userEvent.setup();await user.clear(screen.getByRole("textbox",{name:"发布标题"}));await user.type(screen.getByRole("textbox",{name:"发布标题"}),"交付标题");await user.type(screen.getByRole("textbox",{name:"发布简介"}),"真实简介");await user.type(screen.getByRole("textbox",{name:"发布标签"}),"创作，记录");
 const cover=new File(["fixture"],"cover.png",{type:"image/png"});await user.upload(screen.getByLabelText("选择封面"),cover);
 const form=screen.getByRole("button",{name:"生成发布包并完成生产"}).closest("form")!;fireEvent.submit(form);fireEvent.submit(form);expect(onPrepare).toHaveBeenCalledTimes(1);expect(onPrepare).toHaveBeenCalledWith({cover,title:"交付标题",description:"真实简介",tags:["创作","记录"]});
 finish(false);await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("发布包尚未生成"));
});
