import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Database, Json } from "../lib/database.types";
import type { WorkerPreflightResult } from "../worker/contracts";
import type { ExternalConnectionVersion } from "../connections/ConnectionWorkspace";
import { AccountWorkspace } from "../App";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

type Account = Database["public"]["Tables"]["accounts"]["Row"];
type Blueprint = Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
type Series = Database["public"]["Tables"]["series"]["Row"];
type SeriesVersion = Database["public"]["Tables"]["series_versions"]["Row"];
type PromptVersion = Database["public"]["Tables"]["prompt_versions"]["Row"];
type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"];

const account: Account = { archived_at: null, created_at: "2026-08-14T00:00:00.000Z", current_blueprint_version_id: "blueprint-3", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" };
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

function PromptVersionRefreshWorkspace() {
  const [policy, setPolicy] = useState<Record<string, Json>>(blueprint.policy as Record<string, Json>);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  return <AccountWorkspace account={account} accounts={[account]} blueprints={[{ ...blueprint, policy }]} isPending="" onCreatePromptVersion={async (input) => {
    const created: PromptVersion = { account_id: account.id, capability: input.capability, content_hash: "a".repeat(64), created_at: "2026-08-23T00:00:00.000Z", created_by: "owner-1", id: "harness-storyboard-2", instructions: input.instructions, is_active: true, name: input.name, slug: "storyboard-planning-v2", summary: input.summary, version: 2 };
    setPolicy({ ...policy });
    setPromptVersions([created]);
    return created;
  }} onSelectAccount={vi.fn()} promptVersions={promptVersions} />;
}

describe("账号配置工作区", () => {
  it("用当前配置工作区取代蓝图版本管理", () => {
    renderWorkspace({ blueprints: [blueprint, { ...blueprint, id: "old", is_active: false, version: 2 }], onUpdateBlueprint: vi.fn().mockResolvedValue(blueprint) });

    expect(screen.getByLabelText("当前账号")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "蓝图配置" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "蓝图配置分区" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "账号默认配置检查" })).toBeTruthy();
    expect(screen.queryByText("蓝图版本")).toBeNull();
    expect(screen.queryByRole("button", { name: /激活|归档|停用/ })).toBeNull();
  });

  it("在账号操作菜单集中展示信息并支持归档", async () => {
    const user = userEvent.setup();
    const onSetAccountArchived = vi.fn().mockResolvedValue(true);
    renderWorkspace({ accountEpisodeCount: 7, onSetAccountArchived });

    await user.click(screen.getByRole("button", { name: "账号操作" }));
    const menu = screen.getByRole("menu", { name: "账号操作" });
    expect(within(menu).getByText("dao-studio")).toBeTruthy();
    expect(within(menu).getByText("Asia/Shanghai")).toBeTruthy();
    expect(within(menu).getByText("7 个")).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "归档账号" }));
    const dialog = screen.getByRole("dialog", { name: "归档账号" });
    expect(within(dialog).getByText(/已有生产单、系列和历史配置都会保留/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认归档账号" }));
    expect(onSetAccountArchived).toHaveBeenCalledWith(account.id, true);
  });

  it("直接编辑并保存当前蓝图", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint });

    await user.clear(screen.getByLabelText("账号定位"));
    await user.type(screen.getByLabelText("账号定位"), "新定位");
    await user.click(screen.getByRole("button", { name: "保存并检查" }));
    const dialog = screen.getByRole("dialog", { name: "确认保存蓝图" });
    expect(within(dialog).getByRole("region", { name: "本次保存影响" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认保存并检查" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ positioning: "新定位" }));
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

  it("始终展示默认关闭的五项生产能力", () => {
    renderWorkspace();

    for (const name of ["启用图片生成", "启用A-roll", "启用B-roll", "启用旁白", "启用配乐 / 音效"]) {
      const checkbox = screen.getByRole("checkbox", { name }) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      expect(checkbox.disabled).toBe(false);
    }
  });

  it("通过矩阵打开单项能力配置", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));

    const trigger = screen.getByRole("button", { name: "配置B-roll" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "配置B-roll" });
    expect(within(dialog).getByRole("heading", { name: "B-roll" })).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "关闭B-roll配置" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "配置B-roll" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("保存启用但未完成的能力草稿", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint });

    await user.click(screen.getByRole("checkbox", { name: "启用图片生成" }));
    expect(screen.getByText("未配置", { selector: ".capability-matrix-status" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存并检查" }));
    await user.click(screen.getByRole("button", { name: "确认保存并检查" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ static_visual: {} }));
  });

  it("首次启用不自动选择 B-roll 执行路径", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint });

    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));
    await user.click(screen.getByRole("button", { name: "配置B-roll" }));

    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByRole("combobox", { name: "B-roll 执行路径" }) as HTMLSelectElement).value).toBe("");
    expect(within(dialog).queryByRole("combobox", { name: "B-roll Adapter" })).toBeNull();
    expect(within(dialog).queryByRole("combobox", { name: "B-roll 外部连接" })).toBeNull();
    expect(within(dialog).queryByLabelText("API Key")).toBeNull();
  });

  it("把已验证的 Pexels 当前连接直接绑定到 B-roll 蓝图", async () => {
    const user = userEvent.setup();
    const connection: ExternalConnection = { adapter: "pexels_video", created_at: "2026-08-25T00:00:00.000Z", created_by: "owner-1", current_version_id: "11111111-1111-4111-8111-111111111111", id: "11111111-1111-4111-8111-111111111111", last_verification_detail: "Pexels 已接受请求。", last_verified_at: "2026-08-25T00:01:00.000Z", name: "主 Pexels", provider: "pexels", status: "verified" };
    const versions: ExternalConnectionVersion[] = [{ adapter: "pexels_video", connection_id: connection.id, created_at: connection.created_at, endpoint: "https://api.pexels.com", id: connection.current_version_id, is_current: true, provider: "pexels", revoked_at: null, status: "verified", version: 1 }];
    renderWorkspace({ connectionVersions: versions, externalConnections: [connection] });

    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));
    await user.click(screen.getByRole("button", { name: "配置B-roll" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "B-roll 执行路径" }), "external");
    await user.selectOptions(screen.getByRole("combobox", { name: "B-roll Adapter" }), "pexels_video");

    expect(screen.getByText("主 Pexels · v1 · 已验证")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "B-roll 外部连接" })).toBeNull();
  });


  it("旁白和配乐只选择登记的 Adapter 与非秘密连接", async () => {
    const user = userEvent.setup();
    const connection: ExternalConnection = { adapter: "google_tts", created_at: "2026-08-25T00:00:00.000Z", created_by: "owner-1", current_version_id: "33333333-3333-4333-8333-333333333333", id: "33333333-3333-4333-8333-333333333333", last_verification_detail: "连接已接受请求。", last_verified_at: "2026-08-25T00:01:00.000Z", name: "主 Google TTS", provider: "google_tts", status: "verified" };
    const connectionVersions: ExternalConnectionVersion[] = [
      { adapter: "pexels_video", connection_id: "11111111-1111-4111-8111-111111111111", created_at: "2026-08-25T00:00:00.000Z", endpoint: "https://api.pexels.com", id: "11111111-1111-4111-8111-111111111111", is_current: true, provider: "pexels", revoked_at: null, status: "verified", version: 1 },
      { adapter: "freesound_preview", connection_id: "22222222-2222-4222-8222-222222222222", created_at: "2026-08-25T00:00:00.000Z", endpoint: "https://freesound.org/apiv2", id: "22222222-2222-4222-8222-222222222222", is_current: true, provider: "freesound", revoked_at: null, status: "verified", version: 1 },
      { adapter: "google_tts", connection_id: "33333333-3333-4333-8333-333333333333", created_at: "2026-08-25T00:00:00.000Z", endpoint: "https://texttospeech.googleapis.com", id: "33333333-3333-4333-8333-333333333333", is_current: true, provider: "google_tts", revoked_at: null, status: "verified", version: 1 },
    ];
    renderWorkspace({ connectionVersions, externalConnections: [
      { ...connection, adapter: "pexels_video", current_version_id: "11111111-1111-4111-8111-111111111111", id: "11111111-1111-4111-8111-111111111111", name: "主 Pexels", provider: "pexels" },
      { ...connection, adapter: "freesound_preview", current_version_id: "22222222-2222-4222-8222-222222222222", id: "22222222-2222-4222-8222-222222222222", name: "主 Freesound", provider: "freesound" },
      connection,
    ] });

    await user.click(screen.getByRole("checkbox", { name: "启用旁白" }));
    await user.click(screen.getByRole("checkbox", { name: "启用配乐 / 音效" }));
    await user.click(screen.getByRole("button", { name: "配置旁白" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "旁白 执行路径" }), "external");
    await user.selectOptions(screen.getByRole("combobox", { name: "旁白 Adapter" }), "google_tts");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "配置配乐 / 音效" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "配乐 / 音效 执行路径" }), "external");
    await user.selectOptions(screen.getByRole("combobox", { name: "配乐 / 音效 Adapter" }), "freesound_preview");

    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "配置旁白" }));
    expect(screen.queryByRole("combobox", { name: "语言代码" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "旁白 模型" })).toBeTruthy();
    expect(screen.getByText("主 Google TTS · v1 · 已验证")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "配置配乐 / 音效" }));
    expect(screen.getByText("官方 Endpoint：https://freesound.org/apiv2")).toBeTruthy();

    expect(screen.getByText("主 Freesound · v1 · 已验证")).toBeTruthy();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("火山旁白配置不再展示声音和语速字段", async () => {
    const user = userEvent.setup();
    const volcengineBlueprint = { ...blueprint, policy: { ...(blueprint.policy as Record<string, Json>), narration: { execution_path: "external", credential_ref: "44444444-4444-4444-8444-444444444444", executor: { provider: "volcengine_tts", adapter: "volcengine_tts", model: "seed-tts-2.0", prompt_version: "narration-v1" }, allowed_tools: ["read", "write"], max_attempts: 1, voice: { language_code: "zh-CN", name: "zh_female_custom", speaking_rate: 1 } } } };
    renderWorkspace({ blueprints: [volcengineBlueprint] });

    await user.click(screen.getByRole("button", { name: "配置旁白" }));
    expect(screen.queryByLabelText("声音名称")).toBeNull();
    expect(screen.queryByLabelText("语速")).toBeNull();
    expect(screen.queryByText("试听当前音色")).toBeNull();
  });

  it("用本地 Adapter 的完整身份识别就绪状态，并兼容旧检查", async () => {
    const user = userEvent.setup();
    const localBlueprint = { ...blueprint, policy: { ...(blueprint.policy as Record<string, Json>), a_roll: { execution_path: "local", executor: { provider: "openchatcut", adapter: "openchatcut_card_video", model: "openchatcut@0.2.14", prompt_version: "card-video-v1" }, allowed_tools: ["read", "write"] } } };
    const check = { action: "none" as const, adapter: "openchatcut_card_video", capability: "a_roll_generation", check: "local_adapter_readiness", phase: "preflight" as const, provider: "openchatcut", reason: "OpenChatCut 已就绪。", scope: "worker" as const, status: "passed" as const };

    for (const preflight of [{ version: "worker-preflight/v2" as const, checks: [check] }, { version: "worker-preflight/v2" as const, checks: [{ ...check, provider: undefined }] }]) {
      const view = renderWorkspace({ blueprintPreflight: preflight, blueprints: [localBlueprint] });
      await user.click(screen.getByRole("button", { name: "配置A-roll" }));
      expect((within(screen.getByRole("dialog")).getByRole("option", { name: "本地" }) as HTMLOptionElement).disabled).toBe(false);
      view.unmount();
    }
  });

  it("在 A-roll 尚未配置时，仍使用本机 OpenChatCut 状态开放本地路径", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    renderWorkspace({ onUpdateBlueprint, systemStatus: { dependencies: [{ detail: "openchatcut 0.2.14", name: "OpenChatCut", state: "healthy" }], mediaLibrary: { detail: "已挂载", state: "healthy" }, n8n: { detail: "未启动", lastDispatchAt: null, lastEventAt: null, lastHealthCheckAt: null, lastRunAt: null, state: "unknown" }, observedAt: "2026-08-26T00:00:00.000Z" } });

    await user.click(screen.getByRole("checkbox", { name: "启用A-roll" }));
    await user.click(screen.getByRole("button", { name: "配置A-roll" }));

    expect((within(screen.getByRole("dialog")).getByRole("option", { name: "本地" }) as HTMLOptionElement).disabled).toBe(false);
    await user.selectOptions(screen.getByRole("combobox", { name: "A-roll 执行路径" }), "local");
    await user.selectOptions(screen.getByRole("combobox", { name: "A-roll 本地 Adapter" }), "openchatcut_card_video");
    await user.selectOptions(screen.getByRole("combobox", { name: "A-roll 模型" }), "openchatcut@0.2.14");
    await user.selectOptions(screen.getByRole("combobox", { name: "A-roll 卡片预设" }), "card-video-v1");
    await user.type(screen.getByRole("spinbutton", { name: "最大尝试次数" }), "2");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "保存并检查" }));
    await user.click(screen.getByRole("button", { name: "确认保存并检查" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ a_roll: expect.objectContaining({ execution_path: "local", executor: expect.objectContaining({ adapter: "openchatcut_card_video" }) }) }));
    expect(onUpdateBlueprint.mock.calls[0][0].a_roll).not.toHaveProperty("allowed_tools");
  });

  it("选择分镜 Prompt Harness 时保存其不可变标识", async () => {
    const user = userEvent.setup();
    const onUpdateBlueprint = vi.fn().mockResolvedValue(blueprint);
    const harness: PromptVersion = { ...storyboardHarness, name: "分镜规划 v2", slug: "storyboard-planning-v2", version: 2 };
    renderWorkspace({ onUpdateBlueprint, promptVersions: [harness] });

    await user.click(screen.getByRole("button", { name: "修改分镜规划配置" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "分镜规划 Prompt Harness" }), harness.id);
    await user.click(screen.getByRole("button", { name: "保存并检查" }));
    await user.click(screen.getByRole("button", { name: "确认保存并检查" }));

    expect(onUpdateBlueprint).toHaveBeenCalledWith(expect.objectContaining({ executors: expect.objectContaining({ storyboard_planning: expect.objectContaining({ adapter: "codex", harness_id: harness.id, prompt_version: harness.slug }) }) }));
  });

  it("登记分镜 Harness 刷新目录时保留全部生产能力卡片的草稿", async () => {
    const user = userEvent.setup();
    render(<PromptVersionRefreshWorkspace />);

    await user.click(screen.getByRole("checkbox", { name: "启用图片生成" }));
    await user.click(screen.getByRole("checkbox", { name: "启用A-roll" }));
    await user.click(screen.getByRole("checkbox", { name: "启用B-roll" }));
    await user.click(screen.getByRole("checkbox", { name: "启用旁白" }));
    await user.click(screen.getByRole("checkbox", { name: "启用配乐 / 音效" }));
    await user.click(screen.getByRole("button", { name: "配置图片生成" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "图片生成 执行路径" }), "external");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "配置A-roll" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "A-roll 执行路径" }), "manual");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "配置B-roll" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "B-roll 执行路径" }), "external");
    await user.selectOptions(screen.getByRole("combobox", { name: "B-roll Adapter" }), "pexels_video");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "配置旁白" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "旁白 执行路径" }), "external");
    await user.selectOptions(screen.getByRole("combobox", { name: "旁白 Adapter" }), "google_tts");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "配置配乐 / 音效" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "配乐 / 音效 执行路径" }), "external");
    await user.selectOptions(screen.getByRole("combobox", { name: "配乐 / 音效 Adapter" }), "freesound_preview");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "修改分镜规划配置" }));
    await user.click(screen.getByRole("button", { name: "管理 Prompt 版本" }));
    const manager = screen.getByRole("dialog", { name: "管理分镜规划版本" });
    await user.click(within(manager).getByRole("button", { name: "登记新版本" }));
    await user.type(within(manager).getByPlaceholderText("例如：脚本生成·强化冲突 v2"), "分镜规划 v2");
    await user.type(within(manager).getByPlaceholderText("例如：强化开头钩子和人物动机"), "保留已有能力草稿");
    await user.type(within(manager).getByPlaceholderText("例如：开头 3 秒必须提出冲突；结尾保留审核所需的事实依据。"), "生成可审核脚本。");
    await user.click(within(manager).getByRole("button", { name: "保存新版本" }));
    await user.click(screen.getByRole("button", { name: "返回分镜配置" }));
    await user.click(screen.getByRole("button", { name: "关闭分镜规划配置" }));

    for (const name of ["启用图片生成", "启用A-roll", "启用B-roll", "启用旁白", "启用配乐 / 音效"]) {
      expect((screen.getByRole("checkbox", { name }) as HTMLInputElement).checked).toBe(true);
    }
    await user.click(screen.getByRole("button", { name: "配置B-roll" }));
    expect((screen.getByRole("combobox", { name: "B-roll Adapter" }) as HTMLSelectElement).value).toBe("pexels_video");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "配置旁白" }));
    expect((screen.getByRole("combobox", { name: "旁白 Adapter" }) as HTMLSelectElement).value).toBe("google_tts");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "配置配乐 / 音效" }));
    expect((screen.getByRole("combobox", { name: "配乐 / 音效 Adapter" }) as HTMLSelectElement).value).toBe("freesound_preview");
    await user.click(screen.getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "修改分镜规划配置" }));
    expect((screen.getByRole("combobox", { name: "分镜规划 Prompt Harness" }) as HTMLSelectElement).value).toBe("harness-storyboard-2");
  }, 10000);

  it("通过弹窗配置分镜规划", async () => {
    const user = userEvent.setup();
    renderWorkspace({ onCreatePromptVersion: vi.fn().mockResolvedValue(null) });

    expect(screen.queryByRole("button", { name: "修改视觉规划配置" })).toBeNull();
    expect(screen.getByRole("button", { name: "修改分镜规划配置" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "分镜规划 阶段预算" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "分镜规划 Prompt Harness" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "修改分镜规划配置" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "分镜规划 Prompt Harness" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "管理 Prompt 版本" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "关闭分镜规划配置" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("展示真实 Worker 就绪检查并允许重新检查", async () => {
    const user = userEvent.setup();
    const onRefreshBlueprintPreflight = vi.fn().mockResolvedValue(undefined);
    const preflight: WorkerPreflightResult = { version: "worker-preflight/v1", checks: [{ action: "contact_environment_admin", capability: "b_roll_generation", check: "credential_presence", phase: "preflight", reason: "缺少 PEXELS_API_KEY", scope: "worker", status: "unavailable" }] };
    renderWorkspace({ blueprintPreflight: preflight, onRefreshBlueprintPreflight });

    const rail = screen.getByRole("complementary", { name: "账号默认配置检查" });
    expect(within(rail).getByText("1 项需要处理")).toBeTruthy();
    expect(within(rail).getByText("缺少外部连接凭据")).toBeTruthy();
    expect(within(rail).getByText("缺少 PEXELS_API_KEY")).toBeTruthy();
    await user.click(within(rail).getByRole("button", { name: "重新检查" }));
    expect(onRefreshBlueprintPreflight).toHaveBeenCalledOnce();
  });

  it("合并影响审核渲染和最终渲染的同一 OpenChatCut 环境故障", () => {
    const preflight: WorkerPreflightResult = {
      version: "worker-preflight/v2",
      checks: [
        { action: "contact_environment_admin", capability: "review_rendering", check: "command_availability", phase: "preflight", reason: "spawn openchatcut ENOENT", scope: "worker", status: "unavailable" },
        { action: "contact_environment_admin", capability: "final_rendering", check: "command_availability", phase: "preflight", reason: "spawn openchatcut ENOENT", scope: "worker", status: "unavailable" },
      ],
    };

    renderWorkspace({ blueprintPreflight: preflight });

    const rail = screen.getByRole("complementary", { name: "账号默认配置检查" });
    expect(within(rail).getByText("1 项需要处理")).toBeTruthy();
    expect(within(rail).getByText("OpenChatCut 未就绪")).toBeTruthy();
    expect(within(rail).getByText("影响阶段：审核渲染、最终渲染")).toBeTruthy();
    expect(within(rail).getAllByText("spawn openchatcut ENOENT")).toHaveLength(1);
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

  it("系列页展示版本历史并通过新版本保存", async () => {
    const user = userEvent.setup();
    const onCreateSeriesVersion = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onCreateSeriesVersion, series: [series], seriesVersions });

    await user.click(screen.getByRole("tab", { name: "系列" }));
    expect(screen.getByRole("heading", { name: `${series.name} · 当前 v2` })).toBeTruthy();
    expect((screen.getByLabelText("系列定位") as HTMLTextAreaElement).value).toBe("当前系列定位");
    expect(screen.getByRole("heading", { name: "版本历史" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存为 v3" }));
    const dialog = screen.getByRole("dialog", { name: "确认保存系列版本" });
    expect(within(dialog).getByText(/创建系列 v3/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认保存为 v3" }));
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
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
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
    expect(screen.getByText(/该账号有 1 个生产单，当前不能删除/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认删除账号" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("无生产单时要求输入账号名后才删除", async () => {
    const user = userEvent.setup();
    const onDeleteAccount = vi.fn().mockResolvedValue(true);
    renderWorkspace({ accountEpisodeCount: 0, onDeleteAccount });
    await user.click(screen.getByRole("button", { name: "账号操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除账号" }));
    const dialog = screen.getByRole("dialog", { name: "删除账号" });
    const confirm = within(dialog).getByRole("button", { name: "确认删除账号" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("删除账号确认文本"), account.name);
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    expect(onDeleteAccount).toHaveBeenCalledWith(account.id, account.name);
  });

  it("从生产单进入时只显示定向修复表单", () => {
    renderWorkspace({ blueprintRepairContext: { blocker: { code: "b_roll_executor_unavailable", detail: "B-roll 缺少适配器", taskType: "prepare_visual_brief" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" } });
    expect(screen.getByRole("heading", { name: "修复当前生产单的 B-roll" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存并继续当前生产单" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "账号默认配置检查" })).toBeNull();
  });

  it("按 Worker 的可修复目标打开对应配置，不读取错误文案", () => {
    renderWorkspace({ blueprintRepairContext: { blocker: { action: "edit_blueprint", capability: "b_roll_generation", code: "blueprint_configuration", detail: "需要更新配置。" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" } });

    expect(screen.getByRole("heading", { name: "修复当前生产单的 B-roll" })).toBeTruthy();
  });

  it("修复视觉或分镜阻塞时冻结同一个已登记 Harness", async () => {
    const user = userEvent.setup();
    const onApplyEpisodeRepair = vi.fn().mockResolvedValue(true);
    renderWorkspace({ blueprintRepairContext: { blocker: { code: "storyboard_executor_invalid", detail: "分镜规划缺少 Harness", taskType: "prepare_visual_brief" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" }, onApplyEpisodeRepair });

    expect((screen.getByLabelText("Prompt Harness") as HTMLSelectElement).value).toBe(storyboardHarness.id);
    await user.click(screen.getByRole("button", { name: "保存并继续当前生产单" }));

    await waitFor(() => expect(onApplyEpisodeRepair).toHaveBeenCalledWith(expect.objectContaining({ policy: expect.objectContaining({ executors: expect.objectContaining({ storyboard_planning: expect.objectContaining({ harness_id: storyboardHarness.id }) }) }) })));
  });
});
