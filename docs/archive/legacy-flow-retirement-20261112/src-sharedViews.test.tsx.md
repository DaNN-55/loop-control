# Retired task execution tests

Source: `src/sharedViews.test.tsx`

```tsx


  it("从阻塞项直接修复当前生产单而不新增蓝图版本", async () => {
    const user = userEvent.setup();
    const account = { created_at: "2026-08-15T00:00:00.000Z", current_blueprint_version_id: "blueprint-current", id: "account-1", name: "道工作室", slug: "dao-studio", timezone: "Asia/Shanghai" } as Database["public"]["Tables"]["accounts"]["Row"];
    const blueprint = { account_id: account.id, created_at: "2026-08-15T00:00:00.000Z", id: "blueprint-episode", is_active: true, policy: { positioning: "旧定位", asset_root: "/Volumes/Media/dao", approval_gates: ["script"], allowed_tools: ["read", "write"], budgets: { script_writing_cents: 0, visual_planning_cents: 0, storyboard_planning_cents: 0 }, executors: { script_writing: { provider: "codex", model: "model-a", prompt_version: "script-v1" }, visual_planning: { provider: "codex", model: "model-b", prompt_version: "visual-v1" }, storyboard_planning: { provider: "codex", model: "model-c", prompt_version: "storyboard-v1" } } }, version: 1 } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const currentBlueprint = { ...blueprint, id: "blueprint-current", policy: { ...(blueprint.policy as Record<string, unknown>), a_roll: { execution_path: "manual", executor: { provider: "codex", adapter: "codex", model: "video-generation-v1", prompt_version: "a-roll-v1" }, allowed_tools: ["read", "write"], budget_cents: 100, max_attempts: 2 } } } as Database["public"]["Tables"]["account_blueprint_versions"]["Row"];
    const onApplyEpisodeRepair = vi.fn().mockResolvedValue(true);

    render(<AccountWorkspace account={account} blueprints={[blueprint, currentBlueprint]} blueprintRepairContext={{ blocker: { code: "a_roll_executor_invalid", detail: "A-roll 执行器 adapter 未配置。" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" }} isPending="" onApplyEpisodeRepair={onApplyEpisodeRepair} onCreateSeries={vi.fn()} series={[]} seriesVersions={[]} />);

    expect(await screen.findByRole("heading", { name: "修复当前生产单的 A-roll" })).toBeTruthy();
    expect(screen.queryByText("脚本生成", { selector: "h4" })).toBeNull();
    expect((screen.getByLabelText("A-roll 执行路径") as HTMLSelectElement).value).toBe("manual");
    expect(screen.getByText("Episode 会按镜头与音频 cue 生成待补齐素材清单，不创建 Worker 或外部任务。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存并继续当前生产单" }));

    await waitFor(() => expect(onApplyEpisodeRepair).toHaveBeenCalledWith(expect.objectContaining({
      context: { blocker: { code: "a_roll_executor_invalid", detail: "A-roll 执行器 adapter 未配置。" }, blueprintVersionId: "blueprint-episode", episodeId: "episode-1" },
      policy: expect.objectContaining({
        a_roll: expect.objectContaining({
          execution_path: "manual",
        }),
      }),
    })));
  });
```
