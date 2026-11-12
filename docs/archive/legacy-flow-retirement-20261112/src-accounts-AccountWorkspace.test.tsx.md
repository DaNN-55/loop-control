# Retired task execution tests

Source: `src/accounts/AccountWorkspace.test.tsx`

```tsx


  it("从生产单进入时只显示定向修复表单", () => {
    renderWorkspace({ blueprintRepairContext: { blocker: { code: "b_roll_executor_unavailable", detail: "B-roll 缺少适配器", taskType: "generate_b_roll" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" } });
    expect(screen.getByRole("heading", { name: "修复当前生产单的 B-roll" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存并继续当前生产单" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "账号默认配置检查" })).toBeNull();
  });


  it("按 Worker 的可修复目标打开对应配置，不读取错误文案", () => {
    renderWorkspace({ blueprintRepairContext: { blocker: { action: "edit_blueprint", capability: "b_roll_generation", code: "blueprint_configuration", detail: "需要更新配置。" }, blueprintVersionId: blueprint.id, episodeId: "episode-1" } });

    expect(screen.getByRole("heading", { name: "修复当前生产单的 B-roll" })).toBeTruthy();
  });


  it("旧规划阻塞只读保留，不再打开Harness修复入口", () => {
    const onApplyEpisodeRepair=vi.fn();
    renderWorkspace({blueprintRepairContext:{blocker:{code:"storyboard_executor_invalid",detail:"历史规划阻塞",taskType:"prepare_visual_brief"},blueprintVersionId:blueprint.id,episodeId:"episode-1"},onApplyEpisodeRepair});
    expect(screen.queryByLabelText("Prompt Harness")).toBeNull();
    expect(screen.queryByRole("button",{name:"保存并继续当前生产单"})).toBeNull();
    expect(screen.getByRole("button",{name:"返回生产单"})).toBeTruthy();
    expect(onApplyEpisodeRepair).not.toHaveBeenCalled();
  });
```
