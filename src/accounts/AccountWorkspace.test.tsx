import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Database, Json } from "../lib/database.types";
import type { WorkerPreflightResult } from "../worker/contracts";
import { AccountWorkspace } from "../App";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type Series = Database["public"]["Tables"]["series"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];
type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];
type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"];

const account: Account = { created_at: "2026-08-14T00:00:00.000Z", current_blueprint_version_id: "blueprint-3", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" };
const storyboardHarness: PromptVersion = { account_id: account.id, capability: "storyboard_planning", content_hash: "a".repeat(64), created_at: "2026-08-22T00:00:00.000Z", created_by: "owner-1", id: "harness-storyboard-1", instructions: "先写可执行镜头。", is_active: true, name: "分镜规划 v1", slug: "storyboard-planning-v1", summary: "为审核准备可执行分镜。", version: 1 };
const blueprint: Blueprint = { account_id: account.id, archived_at: null, created_at: "2026-08-14T00:00:00.000Z", id: "blueprint-3", is_active: true, is_snapshot: false, policy: { approval_gates: ["script", "qc"], asset_root: "/Volumes/dao", executors: { storyboard_planning: { adapter: "codex", harness_id: storyboardHarness.id, model: "gpt-5.6-luna", prompt_version: storyboardHarness.slug }, visual_planning: { adapter: "codex", harness_id: storyboardHarness.id, model: "gpt-5.6-luna", prompt_version: storyboardHarness.slug } }, positioning: "越南民间信仰" }, version: 3 };
const series: Series = { account_id: account.id, created_at: "2026-08-14T00:00:00.000Z", id: "series-1", name: "越南民间传说" };
const seriesVersions: SeriesVersion[] = [
  { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", created_by: "owner-1", id: "series-version-2", rules: { positioning: "当前系列定位" }, series_id: series.id, version: 2 },
  { account_id: account.id, created_at: "2026-08-14T00:00:00.000Z", created_by: "owner-1", id: "series-version-1", rules: { positioning: "旧定位" }, series_id: series.id, version: 1 },
];

function renderWorkspace(overrides: Partial<ComponentProps<typeof AccountWorkspace>> = {}) {
  return render(<AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint]} isPending="" onSelectAccount={vi.fn()} promptVersions={[storyboardHarness]} {...overrides} />);
}

function PromptVersionRefreshWorkspace({ onUpdateBlueprint }: { onUpdateBlueprint?: ComponentProps<typeof AccountWorkspace>["onUpdateBlueprint"] }) {
  const [policy, setPolicy] = useState<Record<string, Json>>(blueprint.policy as Record<string, Json>);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  return <AccountWorkspace account={account} accounts={[account]} blueprints={[{ ...blueprint, policy }]} isPending="" onCreatePromptVersion={async (input) => {
    const created: PromptVersion = { account_id: account.id, capability: input.capability, content_hash: "a".repeat(64), created_at: "2026-08-23T00:00:00.000Z", created_by: "owner-1", id: "harness-storyboard-2", instructions: input.instructions, is_active: true, name: input.name, slug: "storyboard-planning-v2", summary: input.summary, version: 2 };
    setPolicy({ ...policy });
    setPromptVersions([created]);
    return created;
  }} onSelectAccount={vi.fn()} onUpdateBlueprint={onUpdateBlueprint} promptVersions={promptVersions} />;
}

describe("账号配置工作区", () => {
  it("用当前配置工作区取代蓝图版本管理", () => {
    renderWorkspace({ blueprints: [blueprint, { ...blueprint, id: "old", is_active: false, version: 2 }], onUpdateBlueprint: vi.fn().mockResolvedValue(blueprint) });

    expect(screen.getByLabelText("当前账号")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "蓝图配置" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "蓝图配置分区" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "生产就绪检查" })).toBeTruthy();
    expect(screen.queryByText("蓝图版本")).toBeNull();
    expect(screen.queryByRole("button", { name: /激活|归档|停用/ })).toBeNull();
  });

  it("直接编辑并保存当前蓝图", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint });

    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "新定位");
    await user.click(screen.getByRole("button", { name: "保存并检查" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ positioning: "新定位" }));
  });

  it("登记 Prompt 时不把蓝图保存按钮显示为保存中", () => {
    renderWorkspace({ isPending: "prompt-version" });

    expect(screen.getByRole("button", { name: "保存并检查" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "保存中…" })).toBeNull();
  });

  it("取消编辑会恢复当前保存值", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderWorkspace({ onDirtyChange });
    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "未保存定位");
    await user.click(screen.getByRole("button", { name: "取消编辑" }));
    expect((screen.getByLabelText("账号定位") as HTMLTextAreaElement).value).toBe("越南民间信仰");
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("有未保存修改时确认后才切换到系列", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace();
    await user.type(screen.getByLabelText("账号定位"), "未保存");
    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("tab", { name: "蓝图" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("tab", { name: "系列" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockRestore();
  });

  it("左侧分区导航都有真实目标", () => {
    renderWorkspace();
    expect(document.querySelector("#account-rules")).toBeTruthy();
    expect(document.querySelector("#account-capabilities")).toBeTruthy();
    expect(document.querySelector("#account-budget")).toBeTruthy();
    expect(document.querySelector("#account-budget")?.tagName).toBe("FIELDSET");
  });

  it("右侧滚动时更新左侧当前分区", async () => {
    renderWorkspace();
    const positions = { "#account-rules": -400, "#account-capabilities": 80, "#account-budget": 420 };
    for (const [selector, top] of Object.entries(positions)) {
      Object.defineProperty(document.querySelector(selector), "getBoundingClientRect", { configurable: true, value: () => ({ top }) });
    }

    await act(async () => window.dispatchEvent(new Event("scroll")));

    await waitFor(() => expect(screen.getByRole("link", { name: "生产能力" }).getAttribute("aria-current")).toBe("location"));
  });

  it("点击左侧分区时立即更新高亮", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("link", { name: "生产能力" }));

    expect(screen.getByRole("link", { name: "生产能力" }).getAttribute("aria-current")).toBe("location");
  });

  it("始终展示默认关闭的五项生产能力", () => {
    renderWorkspace();

    for (const name of ["启用静态视觉 / 图片生成", "启用A-roll", "启用B-roll", "启用旁白", "启用配乐 / 音效"]) {
      const checkbox = screen.getByRole("checkbox", { name }) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      expect(checkbox.disabled).toBe(false);
    }
  });

  it("打开可用能力后显示配置卡片", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));

    expect(screen.getByRole("heading", { name: "B-roll" })).toBeTruthy();
    expect(screen.getByText("已启用能力的技术配置（1）", { selector: "summary" }).parentElement?.hasAttribute("open")).toBe(true);
  });

  it("保存启用但未完成的能力草稿", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint });

    await user.click(screen.getByRole("checkbox", { name: "启用静态视觉 / 图片生成" }));
    expect(screen.getByRole("heading", { name: "静态视觉 / 图片生成" })).toBeTruthy();
    expect(screen.getByText("未配置", { selector: ".media-adapter-status" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存并检查" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ static_visual: {} }));
  });

  it("从注册目录选择 B-roll Adapter 和非秘密连接引用", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint });

    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));

    expect((screen.getByRole("combobox", { name: "B-roll Adapter" }) as HTMLSelectElement).value).toBe("__unregistered__");
    expect(screen.queryByRole("combobox", { name: "B-roll 外部连接" })).toBeNull();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("只把已验证的 Pexels 连接提供给 B-roll 蓝图", async () => {
    const user = userEvent.setup();
    const connection: ExternalConnection = { adapter: "pexels_video", created_at: "2026-08-25T00:00:00.000Z", created_by: "owner-1", current_version_id: "22222222-2222-4222-8222-222222222222", id: "11111111-1111-4111-8111-111111111111", last_verification_detail: "Pexels 已接受请求。", last_verified_at: "2026-08-25T00:01:00.000Z", name: "主 Pexels", provider: "pexels", status: "verified" };
    renderWorkspace({ externalConnections: [connection] });

    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "B-roll Adapter" }), "pexels_video");

    expect(screen.getByRole("option", { name: "主 Pexels · 已验证" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "B-roll 外部连接" }) as HTMLSelectElement).value).toBe(connection.current_version_id);
  });

  it("A-roll 和 B-roll 都可选择本地 HyperFrames 卡片视频", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("checkbox", { name: "启用A-roll" }));
    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "A-roll Adapter" }), "hyperframes_card_video");
    await user.selectOptions(screen.getByRole("combobox", { name: "B-roll Adapter" }), "hyperframes_card_video");

    expect(screen.getAllByDisplayValue("hyperframes")).toHaveLength(2);
    expect(screen.queryByRole("combobox", { name: "A-roll 外部连接" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "B-roll 外部连接" })).toBeNull();
  });

  it("旁白和配乐只选择登记的 Adapter 与非秘密连接", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("checkbox", { name: "启用旁白" }));
    await user.click(screen.getByRole("checkbox", { name: "启用配乐 / 音效" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "旁白 Adapter" }), "google_tts");
    await user.selectOptions(screen.getByRole("combobox", { name: "配乐 / 音效 Adapter" }), "freesound_preview");

    expect(within(screen.getByRole("combobox", { name: "语言代码" })).getByRole("option", { name: "en-US" })).toBeTruthy();

    expect((screen.getByRole("combobox", { name: "旁白 外部连接" }) as HTMLSelectElement).value).toBe("google-tts-default");
    expect((screen.getByRole("combobox", { name: "配乐 / 音效 外部连接" }) as HTMLSelectElement).value).toBe("freesound-default");
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("登记分镜 Prompt Harness 时保存其不可变标识", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    render(<PromptVersionRefreshWorkspace onUpdateBlueprint={onUpdateBlueprint} />);

    await user.click(screen.getByRole("button", { name: "修改分镜规划" }));
    await user.type(screen.getByPlaceholderText("例如：脚本生成·强化冲突 v2"), "分镜规划 v2");
    await user.type(screen.getByPlaceholderText("例如：强化开头钩子和人物动机"), "强化镜头依据");
    await user.type(screen.getByPlaceholderText("例如：开头 3 秒必须提出冲突；结尾保留审核所需的事实依据。"), "先补齐视觉依据。");
    await user.click(screen.getByRole("button", { name: "登记新版本" }));

    expect(screen.queryByRole("dialog", { name: "登记分镜规划新版本" })).toBeNull();
    const selectedHint = screen.getByText("已选择 storyboard-planning-v2；点击“保存并检查”后用于之后新建的生产单。");
    expect(screen.getByRole("button", { name: "修改分镜规划" }).compareDocumentPosition(selectedHint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存并检查" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ executors: expect.objectContaining({ storyboard_planning: expect.objectContaining({ adapter: "codex", harness_id: "harness-storyboard-2", prompt_version: "storyboard-planning-v2" }) }) }));
  });

  it("登记分镜 Harness 刷新目录时保留全部生产能力卡片的草稿", async () => {
    const user = userEvent.setup();
    render(<PromptVersionRefreshWorkspace />);

    await user.click(screen.getByRole("checkbox", { name: "启用静态视觉 / 图片生成" }));
    await user.click(screen.getByRole("checkbox", { name: "启用A-roll" }));
    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));
    await user.click(screen.getByRole("checkbox", { name: "启用旁白" }));
    await user.click(screen.getByRole("checkbox", { name: "启用配乐 / 音效" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "B-roll Adapter" }), "pexels_video");
    await user.selectOptions(screen.getByRole("combobox", { name: "旁白 Adapter" }), "google_tts");
    await user.selectOptions(screen.getByRole("combobox", { name: "配乐 / 音效 Adapter" }), "freesound_preview");
    await user.click(screen.getByRole("button", { name: "修改分镜规划" }));
    await user.type(screen.getByPlaceholderText("例如：脚本生成·强化冲突 v2"), "分镜规划 v2");
    await user.type(screen.getByPlaceholderText("例如：强化开头钩子和人物动机"), "保留已有能力草稿");
    await user.type(screen.getByPlaceholderText("例如：开头 3 秒必须提出冲突；结尾保留审核所需的事实依据。"), "生成可审核脚本。");
    await user.click(screen.getByRole("button", { name: "登记新版本" }));

    for (const name of ["启用静态视觉 / 图片生成", "启用A-roll", "启用B-roll", "启用旁白", "启用配乐 / 音效"]) {
      expect((screen.getByRole("checkbox", { name }) as HTMLInputElement).checked).toBe(true);
    }
    expect((screen.getByRole("combobox", { name: "B-roll Adapter" }) as HTMLSelectElement).value).toBe("pexels_video");
    expect((screen.getByRole("combobox", { name: "旁白 Adapter" }) as HTMLSelectElement).value).toBe("google_tts");
    expect((screen.getByRole("combobox", { name: "配乐 / 音效 Adapter" }) as HTMLSelectElement).value).toBe("freesound_preview");
    expect(screen.getByText("storyboard-planning-v2")).toBeTruthy();
  });

  it("分镜规划弹窗只登记新版本", async () => {
    const user = userEvent.setup();
    renderWorkspace({ onCreatePromptVersion: vi.fn().mockResolvedValue(null) });

    expect(screen.queryByRole("button", { name: "修改视觉规划配置" })).toBeNull();
    expect(screen.getByRole("button", { name: "修改分镜规划" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "分镜规划 阶段预算" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "修改分镜规划" }));
    expect(screen.getByRole("dialog", { name: "登记分镜规划新版本" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "登记新版本" })).toBeTruthy();
    expect(screen.queryByText("保存后自动生成下一版编号，例如 storyboard-planning-v2。")).toBeNull();
    expect(screen.queryByText("适用阶段：分镜规划")).toBeNull();
    const history = screen.getByLabelText("分镜规划历史版本") as HTMLDetailsElement;
    expect(history.open).toBe(false);
    await user.click(within(history).getByText("历史版本（1）"));
    expect(history.open).toBe(true);
    expect(within(history).getByText("storyboard-planning-v1")).toBeTruthy();
    expect(screen.queryByLabelText("Prompt 版本目录")).toBeNull();
    expect(screen.queryByRole("button", { name: "完成" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "关闭分镜规划配置" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("原生弹窗接口失效时，修改分镜规划仍会打开", async () => {
    const originalShowModal = HTMLDialogElement.prototype.showModal;
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: () => { throw new Error("showModal is unavailable"); } });
    const user = userEvent.setup();

    try {
      renderWorkspace();
      await user.click(screen.getByRole("button", { name: "修改分镜规划" }));
      expect(screen.getByRole("dialog", { name: "登记分镜规划新版本" })).toBeTruthy();
    } finally {
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: originalShowModal });
    }
  });

  it("展示真实 Worker 就绪检查并允许重新检查", async () => {
    const user = userEvent.setup();
    const onRefreshBlueprintPreflight = vi.fn().mockResolvedValue(undefined);
    const preflight: WorkerPreflightResult = { version: "worker-preflight/v1", checks: [{ action: "contact_environment_admin", capability: "b_roll_generation", check: "credential_presence", phase: "preflight", reason: "缺少 PEXELS_API_KEY", scope: "worker", status: "unavailable" }] };
    renderWorkspace({ blueprintPreflight: preflight, onRefreshBlueprintPreflight });

    const rail = screen.getByRole("complementary", { name: "生产就绪检查" });
    expect(within(rail).getByText("1 项需要处理")).toBeTruthy();
    expect(within(rail).getByText("缺少外部连接凭据")).toBeTruthy();
    expect(within(rail).getByText("缺少 PEXELS_API_KEY")).toBeTruthy();
    await user.click(within(rail).getByRole("button", { name: "重新检查" }));
    expect(onRefreshBlueprintPreflight).toHaveBeenCalledOnce();
  });

  it("不在第一屏展示冗长的运行命令错误", () => {
    const reason = `模型权限探测失败：${"Command failed ".repeat(20)}`;
    const preflight: WorkerPreflightResult = { version: "worker-preflight/v1", checks: [{ action: "contact_environment_admin", capability: "script_writing", check: "model_permission", phase: "preflight", reason, scope: "worker", status: "unavailable" }] };
    renderWorkspace({ blueprintPreflight: preflight });

    expect(screen.getByText("运行环境检查未通过，请联系环境管理员。")).toBeTruthy();
    expect(screen.queryByText(reason)).toBeNull();
  });

  it("不在第一屏展示冗长的接口错误", () => {
    const error = `检查接口失败：${"server trace ".repeat(20)}`;
    renderWorkspace({ blueprintPreflightError: error });
    expect(screen.getByText("生产就绪检查暂时失败，请稍后重新检查。")).toBeTruthy();
    expect(screen.queryByText(error)).toBeNull();
  });

  it("系列页只展示当前配置并通过内部快照保存", async () => {
    const user = userEvent.setup();
    const onCreateSeriesVersion = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onCreateSeriesVersion, series: [series], seriesVersions });

    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("heading", { name: series.name })).toBeTruthy();
    expect((screen.getByLabelText("系列定位") as HTMLTextAreaElement).value).toBe("当前系列定位");
    expect(screen.queryByText("历史版本")).toBeNull();
    await user.click(screen.getByRole("button", { name: "保存系列配置" }));
    expect(onCreateSeriesVersion).toHaveBeenCalledWith({ seriesId: series.id, rules: expect.objectContaining({ positioning: "当前系列定位" }) });
  });

  it("系列有未保存修改时也会拦截离开", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace({ series: [series], seriesVersions });
    await user.click(screen.getByRole("tab", { name: "系列" }));
    await user.type(screen.getByLabelText("系列定位"), "未保存");
    await user.click(screen.getByRole("tab", { name: "蓝图" }));
    expect(screen.getByRole("tab", { name: "系列" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("tab", { name: "蓝图" }));
    expect(screen.getByRole("tab", { name: "蓝图" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockRestore();
  });

  it("保留新建系列入口", async () => {
    const user = userEvent.setup();
    function RerenderingWorkspace() {
      const [, setDirty] = useState(false);
      return <AccountWorkspace account={account} accounts={[account]} blueprints={[blueprint]} isPending="" onDirtyChange={setDirty} onSelectAccount={vi.fn()} series={[series]} seriesVersions={[...seriesVersions]} />;
    }
    render(<RerenderingWorkspace />);
    await user.click(screen.getByRole("tab", { name: "系列" }));
    await user.click(screen.getByRole("button", { name: "新建系列" }));
    expect(screen.getByRole("heading", { name: "新建系列" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建系列" })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "系列名称" }), "新系列");
    expect((screen.getByRole("textbox", { name: "系列名称" }) as HTMLInputElement).value).toBe("新系列");
  });

  it("支持重命名账号", async () => {
    const user = userEvent.setup();
    const onRenameAccount = vi.fn().mockResolvedValue(true);
    renderWorkspace({ onRenameAccount });
    await user.click(screen.getByRole("button", { name: "账号操作" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "重命名账号" }));
    await user.clear(screen.getByRole("textbox", { name: "账号显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "账号显示名称" }), "新名称");
    await user.click(screen.getByRole("button", { name: "保存名称" }));
    expect(onRenameAccount).toHaveBeenCalledWith(account.id, "新名称");
  });

  it("有生产单时阻止删除账号", async () => {
    const user = userEvent.setup();
    renderWorkspace({ accountEpisodeCount: 1 });
    await user.click(screen.getByRole("button", { name: "账号操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除账号" }));
    expect(screen.getByText("该账号有 1 个生产单，当前不能删除。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认删除账号" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("从生产单进入时只显示定向修复表单", () => {
    renderWorkspace({ blueprintRepairContext: { blocker: { code: "b_roll_executor_unavailable", detail: "B-roll 缺少适配器", taskType: "prepare_visual_brief" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" } });
    expect(screen.getByRole("heading", { name: "修复当前生产单的 B-roll" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存并继续当前生产单" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "生产就绪检查" })).toBeNull();
  });

  it("修复分镜阻塞时冻结已登记 Harness", async () => {
    const user = userEvent.setup();
    const onApplyEpisodeRepair = vi.fn().mockResolvedValue(true);
    renderWorkspace({ blueprintRepairContext: { blocker: { code: "storyboard_executor_invalid", detail: "分镜规划缺少 Harness", taskType: "draft_storyboard" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" }, onApplyEpisodeRepair });

    expect((screen.getByLabelText("Prompt Harness") as HTMLSelectElement).value).toBe(storyboardHarness.id);
    await user.click(screen.getByRole("button", { name: "保存并继续当前生产单" }));

    await waitFor(() => expect(onApplyEpisodeRepair).toHaveBeenCalledWith(expect.objectContaining({ policy: expect.objectContaining({ executors: expect.objectContaining({ storyboard_planning: expect.objectContaining({ harness_id: storyboardHarness.id }) }) }) })));
  });
});
