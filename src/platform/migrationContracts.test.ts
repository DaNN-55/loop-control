import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationNames = readdirSync(resolve("supabase/migrations"));
const technicalConfigMigration = resolve(
  "supabase/migrations/20260822121000_use_blueprint_b_roll_technical_config.sql",
);
const legacyOrchestrationPermissionsMigration = resolve(
  "supabase/migrations/20260822121948_restrict_b_roll_legacy_orchestration.sql",
);
const storyboardHarnessMigration = resolve(
  "supabase/migrations/20260822215000_freeze_storyboard_harness.sql",
);
const audioAdapterConnectionsMigration = resolve(
  "supabase/migrations/20260822223000_freeze_audio_adapter_connections.sql",
);
const audioToolPermissionsMigration = resolve(
  "supabase/migrations/20260822223500_normalize_audio_tool_permissions.sql",
);
const approvedVisualManifestMigration = resolve(
  "supabase/migrations/20260822223700_freeze_approved_visual_manifest.sql",
);
const manualArollMigration = resolve(
  "supabase/migrations/20260823103000_add_manual_a_roll_uploads.sql",
);
const hyperframesStudioRevisionMigration = resolve(
  "supabase/migrations/20260824092000_hyperframes_studio_review_revision.sql",
);
const studioStructuralRevisionMigration = resolve(
  "supabase/migrations/20260824100000_request_studio_structural_revision.sql",
);
const studioStructuralReworkApprovalMigration = resolve(
  "supabase/migrations/20260901141000_remove_duplicate_storyboard_rework_approval.sql",
);
const manualArollFixMigration = resolve(
  "supabase/migrations/20260823110000_fix_manual_a_roll_shot_lookup.sql",
);
const manualArollTakeoverMigration = resolve(
  "supabase/migrations/20260823113000_allow_manual_a_roll_takeover.sql",
);
const manualArollReuseMigration = resolve(
  "supabase/migrations/20260823201000_allow_manual_a_roll_reuse.sql",
);
const manualBrollReuseMigration = resolve(
  "supabase/migrations/20260823202000_allow_manual_b_roll_reuse.sql",
);
const replaceManualShotMediaMigration = resolve(
  "supabase/migrations/20260902153000_replace_manual_shot_media.sql",
);
const prepareManualShotClipsMigration = resolve(
  "supabase/migrations/20260902161000_prepare_manual_shot_clips.sql",
);
const scopedEmbeddedAudioMigration = resolve(
  "supabase/migrations/20260823114000_scope_embedded_audio_orchestration.sql",
);
const manualMediaBindingsMigration = resolve(
  "supabase/migrations/20260823120000_add_manual_media_bindings.sql",
);
const scopedSoundtrackMigration = resolve(
  "supabase/migrations/20260823121000_scope_soundtrack_orchestration.sql",
);
const manualPathOrchestrationMigration = resolve(
  "supabase/migrations/20260825150000_skip_manual_media_orchestration.sql",
);
const scopedManualPathCorrectionMigration = resolve(
  "supabase/migrations/20260825160000_scope_manual_media_orchestration.sql",
);
const explicitMediaPathMigration = resolve(
  "supabase/migrations/20260825170000_require_explicit_media_execution_paths.sql",
);
const bRollBudgetOverflowMigration = resolve(
  "supabase/migrations/20260826093000_prevent_b_roll_budget_overflow.sql",
);
const unrestrictedBRollBudgetMigration = resolve(
  "supabase/migrations/20260826094000_treat_unrestricted_b_roll_budget_as_unlimited.sql",
);
const scopedCoreOrchestrationMigration = resolve(
  "supabase/migrations/20260823200000_add_scoped_core_task_orchestration.sql",
);
const episodeAudioSourceMigration = resolve(
  "supabase/migrations/20260823185000_add_episode_audio_source_mode.sql",
);
const volcengineTtsExecutionMigration = resolve(
  "supabase/migrations/20260901111615_enable_volcengine_tts_execution.sql",
);
const blueprintSnapshotVersionMigration = resolve(
  "supabase/migrations/20260823114252_fix_current_blueprint_snapshot_version.sql",
);
const qcEditorMigration = resolve(
  "supabase/migrations/20260823190000_integrate_qc_editor.sql",
);
const qcEditorCompletionMigration = resolve(
  "supabase/migrations/20260823191000_fix_qc_only_review_completion.sql",
);
const editingDeskMigration = resolve(
  "supabase/migrations/20260823203000_move_hyperframes_composition_to_editing_desk.sql",
);
const removeSeriesAdvancedRulesMigration = resolve(
  "supabase/migrations/20260824102000_remove_series_advanced_rules.sql",
);
const sharedPlanningMigration = resolve(
  "supabase/migrations/20260824103000_unify_planning_configuration.sql",
);
const reviewRevisionPreconditionsMigration = resolve(
  "supabase/migrations/20260824110000_deepen_review_revision_preconditions.sql",
);
const internalVisualPreparationMigration = resolve(
  "supabase/migrations/20260824120000_internal_visual_asset_preparation.sql",
);
const uploadedVisualDispatchMigration = resolve(
  "supabase/migrations/20260901103000_fix_uploaded_visual_dispatch.sql",
);
const disabledSoundtrackCueMigration = resolve(
  "supabase/migrations/20260901120000_ignore_disabled_soundtrack_cues.sql",
);
const narrationShotStartMigration = resolve(
  "supabase/migrations/20260901130000_preserve_narration_shot_starts.sql",
);
const studioPreRenderInvalidationMigration = resolve(
  "supabase/migrations/20260901150000_respect_tts_pre_render_audio.sql",
);
const frozenStudioProjectPathMigration = resolve(
  "supabase/migrations/20260901151000_fix_frozen_studio_project_path.sql",
);
const publishCoverFormatsMigration = resolve(
  "supabase/migrations/20260902080000_allow_publish_cover_image_formats.sql",
);
const manualPublicationFlowMigration = resolve(
  "supabase/migrations/20260902004000_complete_manual_publication_flow.sql",
);
const shotPreparationDraftMigration = resolve(
  "supabase/migrations/20260903090000_add_shot_preparation_drafts.sql",
);
const shotTtsMigration = resolve(
  "supabase/migrations/20260903100000_add_shot_tts_generation.sql",
);
const shotClipMigration = resolve(
  "supabase/migrations/20260903110000_generate_shot_clip.sql",
);
const shotAudioModesMigration = resolve(
  "supabase/migrations/20260903120000_complete_shot_audio_modes.sql",
);
const shotConfirmationMigration = resolve(
  "supabase/migrations/20260903130000_confirm_shot_preparation.sql",
);
const shotStructureRevisionMigration = resolve(
  "supabase/migrations/20260903140000_add_storyboard_structure_revision.sql",
);
const confirmedStudioSnapshotMigration = resolve(
  "supabase/migrations/20260903150000_auto_create_confirmed_studio_snapshot.sql",
);
const frozenMultiSegmentShotDraftMigration = resolve(
  "supabase/migrations/20260904100000_freeze_multi_segment_shot_drafts.sql",
);
const deferredStudioTrimmingMigration = resolve(
  "supabase/migrations/20260904110000_defer_shot_trimming_to_studio.sql",
);
const deployedMigrations = {
  "20260822095959_guard_legacy_b_roll_history.sql": "b36e63037ca12c2785d7bbb9f2fe8596f31377de734dcf8b96cb03af23613c9b",
  "20260822100000_freeze_b_roll_adapter_connection.sql": "f38575ba3b5dcb7814f230c5a48a52c6a5ac37811868d00bdb0f7eb375b2a51d",
  "20260822104421_expand_legacy_b_roll_blueprints.sql": "f8182e92f0ccd25ed228e56d92ca54f1ef836954303d5d385b8e0672cd635a8f",
  "20260822112024_remove_legacy_b_roll_history_guard.sql": "f28b35a78d15812e85abc119440d7a7af3c880935dafa344fc9ff13b64663d30",
  "20260822223000_freeze_audio_adapter_connections.sql": "cd1b31c24d56a2e86b2b9c31cc23008d5bced7e8660582f0bd4176622ab05a68",
  "20260822223500_normalize_audio_tool_permissions.sql": "f258ccb1126c76083ffce532f022b8123476eb31a2392a7bd75de220bf27352b",
};

describe("B-roll 连接固化迁移", () => {
  it("只在统一确认时冻结多片段草稿并创建镜头任务", () => {
    const migration = readFileSync(frozenMultiSegmentShotDraftMigration, "utf8");

    expect(migration).toContain("create function public.save_shot_workbench_draft");
    expect(migration).toContain("clip_segments jsonb");
    expect(migration).toContain("create function public.freeze_shot_preparation_batch");
    expect(migration).toContain("'video_clips'");
    expect(migration).toContain("create trigger protect_frozen_shot_preparation_inputs");
    expect(migration).toContain("create trigger zz_queue_source_audio_after_frozen_clip");
  });

  it("冻结时把原片和标记直接交给 Studio，不提前创建裁剪任务", () => {
    const migration = readFileSync(deferredStudioTrimmingMigration, "utf8");

    expect(migration).toContain("source_material_revision_id");
    expect(migration).toContain("create or replace function public.record_pre_render_member_dependencies");
    expect(migration).toContain("new.source_material_revision_id");
    expect(migration).toContain("'clip_segments', draft.clip_segments");
    expect(migration).toContain("'source_material', jsonb_build_object");
    expect(migration).toContain("perform public.orchestrate_review_render_tasks(p_episode_id)");
    expect(migration).not.toContain("'ffmpeg_trim_video'");
    expect(migration).not.toContain("'extract_embedded_audio'");
  });

  it("只从当前已确认镜头创建不可变 Studio 输入，并让生产门禁先创建快照", () => {
    const migration = readFileSync(confirmedStudioSnapshotMigration, "utf8");

    expect(migration).toContain("has_current_shot_preparation_snapshot");
    expect(migration).toContain("draft.confirmation_status = 'confirmed'");
    expect(migration).toContain("draft.input_fingerprint = md5(required.value::text)");
    expect(migration).toContain("video_task.status = 'completed'");
    expect(migration).toContain("audio_track.id = draft.current_audio_track_id");
    expect(migration).toContain("package.context_snapshot ->> 'confirmation_mode' is distinct from 'shot_preparation'");
    expect(migration).toContain("package.context_snapshot ->> 'storyboard_review_package_id' is distinct from p_storyboard_review_package_id::text");
    expect(migration).toContain("if not exists (select 1 from public.create_shot_preparation_review_package(candidate.id, candidate.storyboard_review_package_id)) then continue; end if;");
    expect(migration).toContain("'confirmation_mode', 'shot_preparation'");
    expect(migration).toContain("'input_fingerprint', draft.input_fingerprint");
  });

  it("将镜头结构操作冻结为幂等的分镜审核修订", () => {
    const migration = readFileSync(shotStructureRevisionMigration, "utf8");

    expect(migration).toContain("request_shot_structure_revision");
    expect(migration).toContain("structure_revision_hash");
    expect(migration).toContain("create_storyboard_revision_review_package");
    expect(migration).toContain("storyboard_approved', 'storyboard_review");
    expect(migration).toContain("input_fingerprint");
    expect(migration).toContain("draft.input_fingerprint = md5(shot::text)");
    expect(migration).toContain("previous.current_video_artifact_id");
    expect(migration).toContain("'id', 'shot-' || gen_random_uuid()::text");
    expect(migration).toContain("on conflict (episode_id, review_package_id, shot_id) do nothing");
  });

  it("发布输入登记允许 JPG、PNG 和 WebP 封面", () => {
    const migration = readFileSync(publishCoverFormatsMigration, "utf8");

    expect(migration).toContain("create or replace function public.record_publish_input");
    expect(migration).toContain("cover-v1\\.(jpg|png|webp)$");
    expect(migration).toContain("metadata-v1.json");
  });

  it("人工发布登记从 QC 完成阶段原子推进到已发布", () => {
    const migration = readFileSync(manualPublicationFlowMigration, "utf8");

    expect(migration).toContain("create or replace function public.record_manual_publication");
    expect(migration).toContain("current_stage = 'qc_passed'");
    expect(migration).toContain("'publish_ready'::public.episode_stage");
    expect(migration).toContain("'publishing_review'::public.episode_stage");
    expect(migration).toContain("created_record := public.record_publication(");
  });

  it("保存已被生产单引用的蓝图时，为旧规则分配独立快照版本", () => {
    const migration = readFileSync(blueprintSnapshotVersionMigration, "utf8");

    expect(migration).toContain("next_snapshot_version integer");
    expect(migration).toContain("select coalesce(max(version), 0) + 1 into next_snapshot_version");
    expect(migration).toContain("values (updated_blueprint.account_id, next_snapshot_version");
  });

  it("保持已部署迁移内容不变", () => {
    for (const [filename, expectedHash] of Object.entries(deployedMigrations)) {
      const migration = readFileSync(resolve("supabase/migrations", filename), "utf8");
      expect(createHash("sha256").update(migration).digest("hex")).toBe(expectedHash);
    }
  });

  it("在旧迁移前后安装并移除历史版本保护", () => {
    expect(migrationNames).toContain("20260822095959_guard_legacy_b_roll_history.sql");
    expect(migrationNames).toContain("20260822112024_remove_legacy_b_roll_history_guard.sql");
  });

  it("以账号蓝图而非系列规则冻结 B-roll 技术配置", () => {
    const technicalConfig = readFileSync(technicalConfigMigration, "utf8");

    expect(technicalConfig).toContain("create or replace function public.orchestrate_b_roll_tasks_legacy");
    expect(technicalConfig).toContain("selected_config := candidate.blueprint_policy -> 'b_roll';");
    expect(technicalConfig).not.toContain("series_version.rules as series_rules");
  });

  it("以 bigint 累计 B-roll 预算，避免上限值在多镜头时溢出", () => {
    const migration = readFileSync(bRollBudgetOverflowMigration, "utf8");

    expect(migration).toContain("committed_budget bigint");
    expect(migration).toContain("coalesce(sum(task.budget_limit_cents), 0)::bigint into committed_budget");
  });

  it("将默认的最大预算值按不限预算处理", () => {
    const migration = readFileSync(unrestrictedBRollBudgetMigration, "utf8");

    expect(migration).toContain("total_budget < 2147483647");
  });

  it("只允许 Worker 调用内部 B-roll 编排函数", () => {
    const permissions = readFileSync(legacyOrchestrationPermissionsMigration, "utf8");

    expect(permissions).toContain("revoke all on function public.orchestrate_b_roll_tasks_legacy(uuid) from public, anon, authenticated;");
    expect(permissions).toContain("grant execute on function public.orchestrate_b_roll_tasks_legacy(uuid) to service_role;");
  });

  it("分镜任务冻结已登记 Adapter 与不可变 Prompt Harness", () => {
    const migration = readFileSync(storyboardHarnessMigration, "utf8");

    expect(migration).toContain("and harness.capability = 'storyboard_planning'");
    expect(migration).toContain("'harness', jsonb_build_object(");
    expect(migration).toContain("'adapter', 'codex'");
    expect(migration).toContain("grant execute on function public.orchestrate_storyboard_tasks() to service_role;");
  });

  it("旁白与配乐任务冻结已选择的非秘密连接引用", () => {
    const migration = readFileSync(audioAdapterConnectionsMigration, "utf8");

    expect(migration).toContain("'google-tts-default'");
    expect(migration).toContain("'freesound-default'");
    expect(migration).toContain("orchestrate_narration_tasks_without_connection_ref");
    expect(migration).toContain("orchestrate_soundtrack_tasks_without_connection_ref");
    expect(migration).toContain("set input_snapshot = jsonb_set(task.input_snapshot, '{credential_ref}'");
  });

  it("只保留账号实际授予的音频工具", () => {
    const migration = readFileSync(audioToolPermissionsMigration, "utf8");

    expect(migration).toContain("'{narration,allowed_tools}'");
    expect(migration).toContain("'{soundtrack,allowed_tools}'");
    expect(migration).not.toContain("'network'");
  });

  it("分镜只冻结 Owner 已批准的视觉资产清单", () => {
    const migration = readFileSync(approvedVisualManifestMigration, "utf8");

    expect(migration).toContain("visual_package.artifact_id as approved_visual_artifact_id");
    expect(migration).toContain("artifact.id = candidate.approved_visual_artifact_id");
    expect(migration).not.toContain("artifact.producer_task_id = candidate.visual_task_id and artifact.artifact_type = 'visual_asset_manifest'");
  });

  it("人工 A-roll 独立于自动能力开关，并冻结到已批准的分镜镜头", () => {
    const migration = readFileSync(manualArollMigration, "utf8");

    expect(migration).toContain("'a_roll'");
    expect(migration).toContain("create function public.register_manual_a_roll");
    expect(migration).toContain("'manual_upload'");
    expect(migration).toContain("'a_roll_video'");
    expect(migration).not.toContain("credential_ref");
    expect(readFileSync(manualArollFixMigration, "utf8")).toContain("as shot(value)");
    expect(readFileSync(manualArollTakeoverMigration, "utf8")).toContain("task.status in ('ready', 'blocked', 'failed')");
    expect(readFileSync(resolve("supabase/migrations/20260826095500_fix_manual_media_task_type_ambiguity.sql"), "utf8")).toContain("task.task_type = v_task_type");
    const reusableAroll = readFileSync(manualArollReuseMigration, "utf8");
    expect(reusableAroll).toContain("artifacts_episode_id_artifact_type_relative_path_producer_task_key");
    expect(reusableAroll).not.toContain("This A-roll material is already bound to another storyboard shot");
    expect(readFileSync(manualBrollReuseMigration, "utf8")).not.toContain("This B-roll material is already bound to another storyboard shot");
    expect(readFileSync(scopedEmbeddedAudioMigration, "utf8")).toContain("p_episode_id uuid default null");
    const manualMedia = readFileSync(manualMediaBindingsMigration, "utf8");
    expect(manualMedia).toContain("create function public.register_manual_b_roll");
    expect(manualMedia).toContain("create function public.register_manual_audio");
    expect(manualMedia).toContain("if has_approved_video and exists");
  });

  it("允许 Owner 在合成前替换已确认的人工镜头素材并保留旧任务", () => {
    const migration = readFileSync(replaceManualShotMediaMigration, "utf8");

    expect(migration).toContain("create function public.replace_manual_shot_media");
    expect(migration).toContain("task.status = 'completed'");
    expect(migration).toContain("task.provider = 'manual_upload'");
    expect(migration).toContain("set status = 'superseded'");
    expect(migration).toContain("public.register_manual_a_roll");
    expect(migration).toContain("public.register_manual_b_roll");
  });

  it("允许镜头素材重复替换，并冻结 Studio 前的裁剪区间", () => {
    const migration = readFileSync(prepareManualShotClipsMigration, "utf8");

    expect(migration).toContain("drop index if exists public.tasks_one_a_roll_per_storyboard_shot_configuration_idx");
    expect(migration).toContain("status <> 'superseded'::public.task_status");
    expect(migration).toContain("create function public.save_manual_shot_clip");
    expect(migration).toContain("p_clip_start_seconds numeric");
    expect(migration).toContain("p_clip_end_seconds numeric");
    expect(migration).toContain("'clip_selection'");
  });

  it("声轨编排只处理已开启该能力的指定生产单", () => {
    const migration = readFileSync(scopedSoundtrackMigration, "utf8");

    expect(migration).toContain("p_episode_id uuid default null");
    expect(migration).toContain("blueprint.policy -> 'soundtrack'");
    expect(migration).toContain("p_episode_id is null or episode.id = p_episode_id");
    expect(migration).toContain("'credential_ref', frozen_credential_ref");
  });

  it("关闭声轨能力时不把可选声轨提示当成生产门槛", () => {
    const migration = readFileSync(disabledSoundtrackCueMigration, "utf8");

    expect(migration).toContain("candidate.blueprint_policy -> 'soundtrack'");
    expect(migration).toContain("advance_production_ready_episodes");
    expect(migration).toContain("create_pre_render_review_packages");
  });

  it("分段旁白保留冻结镜头起点，不再按实际音频长度紧密重排", () => {
    const migration = readFileSync(narrationShotStartMigration, "utf8");

    expect(migration).toContain("set start_seconds = (task.input_snapshot #>> '{audio_track,start_seconds}')::numeric");
    expect(migration).toContain("create or replace function public.register_completed_audio_track()");
    expect(migration).not.toContain("sum(track.duration_seconds)");
  });

  it("Studio 结构返工同时作废旧 QC 与旧预渲染清单", () => {
    const migration = readFileSync(studioPreRenderInvalidationMigration, "utf8");

    expect(migration).toContain("request_studio_storyboard_revision(uuid, text)");
    expect(migration).toContain("where id = selected_qc_package.id");
    expect(migration).toContain("where id = selected_pre_render_package.id");
  });

  it("冻结 Studio 工程使用可匹配实际相对路径的数据库正则", () => {
    const migration = readFileSync(frozenStudioProjectPathMigration, "utf8");

    expect(migration).toContain("/studio-frozen/[0-9a-f-]{36}/index[.]html$");
    expect(migration).not.toContain("/index\\\\.html$");
  });

  it("人工路径不进入媒体 Worker 编排", () => {
    const migration = readFileSync(manualPathOrchestrationMigration, "utf8");

    expect(migration).toContain("execution_path}', 'external') <> 'manual");
    expect(migration).toContain("orchestrate_soundtrack_tasks_without_manual_path");
    expect(migration).toContain("orchestrate_a_roll_tasks_without_manual_path");
  });

  it("人工 A-roll 按 Episode 隔离，旁白保留原声模式门槛", () => {
    const migration = readFileSync(scopedManualPathCorrectionMigration, "utf8");

    expect(migration).toContain("orchestrate_a_roll_tasks_for_episode");
    expect(migration).toContain("p_episode_id is null or episode.id = p_episode_id");
    expect(migration).toContain("episode.audio_source_mode = 'tts'");
    expect(migration).toContain("blueprint.policy #>> ''{a_roll,execution_path}'' in (''external'', ''local'')");
    expect(migration).toContain("blueprint.policy #>> '{a_roll,execution_path}' in ('external', 'local')");
    expect(migration).toContain("blueprint.policy #>> '{narration,execution_path}' in ('external', 'local')");
    expect(migration).not.toContain("coalesce(blueprint.policy #>> '{a_roll,execution_path}', 'external')");
    expect(migration).not.toContain("coalesce(blueprint.policy #>> '{narration,execution_path}', 'external')");
    expect(migration).not.toContain("if exists (\n    select 1\n    from public.episodes episode\n    join public.account_blueprint_versions blueprint");
  });

  it("人工旁白使用 Episode 级绑定入口", () => {
    const migration = readFileSync(scopedManualPathCorrectionMigration, "utf8");

    expect(migration).toContain("register_manual_episode_narration");
    expect(migration).toContain("p_episode_id uuid");
    expect(migration).toContain("track.cue_id = candidate.id::text");
  });

  it("只允许 service_role 调用动态创建的 A-roll Episode 编排函数", () => {
    const migration = readFileSync(scopedManualPathCorrectionMigration, "utf8");

    expect(migration).toContain("revoke all on function public.orchestrate_a_roll_tasks_for_episode(uuid) from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function public.orchestrate_a_roll_tasks_for_episode(uuid) to service_role;");
  });

  it("按 Episode 的本地 HyperFrames A-roll 会进入 ready 队列", () => {
    const migration = readFileSync(resolve("supabase/migrations/20260826101000_enable_scoped_local_hyperframes_a_roll.sql"), "utf8");

    expect(migration).toContain("orchestrate_a_roll_tasks_for_episode_without_card_adapter");
    expect(migration).toContain("set status = 'ready'::public.task_status");
    expect(migration).toContain("hyperframes_card_video");
  });

  it("B-roll 与 soundtrack 只调度显式 external 或 local 路径", () => {
    const migration = readFileSync(explicitMediaPathMigration, "utf8");
    const bRollPredicate = "coalesce(blueprint.policy #>> '{b_roll,execution_path}', 'external') <> 'manual'";
    const soundtrackPredicate = "coalesce(blueprint.policy #>> '{soundtrack,execution_path}', 'external') <> 'manual'";
    const bRollReplacement = "blueprint.policy #>> '{b_roll,execution_path}' in ('external', 'local')";
    const soundtrackReplacement = "blueprint.policy #>> '{soundtrack,execution_path}' in ('external', 'local')";
    const sqlString = (value: string) => value.replaceAll("'", "''");

    expect(migration).toContain(`execute replace(definition, '${sqlString(bRollPredicate)}', '${sqlString(bRollReplacement)}')`);
    expect(migration).toContain(`execute replace(definition, '${sqlString(soundtrackPredicate)}', '${sqlString(soundtrackReplacement)}')`);
    const simulatedBrollDefinition = `where ${bRollPredicate}`.replace(bRollPredicate, bRollReplacement);
    const simulatedSoundtrackDefinition = `where ${soundtrackPredicate}`.replace(soundtrackPredicate, soundtrackReplacement);
    expect(simulatedBrollDefinition).not.toContain("<> 'manual'");
    expect(simulatedSoundtrackDefinition).not.toContain("<> 'manual'");
    expect(simulatedBrollDefinition).toContain(bRollReplacement);
    expect(simulatedSoundtrackDefinition).toContain(soundtrackReplacement);
    expect(migration).toContain("revoke all on function public.orchestrate_b_roll_tasks(uuid) from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function public.orchestrate_b_roll_tasks(uuid) to service_role;");
    expect(migration).toContain("revoke all on function public.orchestrate_soundtrack_tasks(uuid) from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function public.orchestrate_soundtrack_tasks(uuid) to service_role;");
  });

  it("定向调度只会创建指定生产单的视觉与分镜任务", () => {
    const migration = readFileSync(scopedCoreOrchestrationMigration, "utf8");

    expect(migration).toContain("orchestrate_provided_script_tasks_for_episode(p_episode_id uuid)");
    expect(migration).toContain("orchestrate_storyboard_tasks_for_episode(p_episode_id uuid)");
    expect(migration).toContain("where episode.id = p_episode_id");
    expect(migration).toContain("grant execute on function public.orchestrate_provided_script_tasks_for_episode(uuid) to service_role;");
    expect(migration).toContain("grant execute on function public.orchestrate_storyboard_tasks_for_episode(uuid) to service_role;");
  });

  it("视觉准备与分镜任务冻结同一套 Adapter、模型和 Harness", () => {
    const migration = readFileSync(sharedPlanningMigration, "utf8");

    expect(migration).toContain("'visual_planning', normalized.planning_executor, 'storyboard_planning', normalized.planning_executor");
    expect(migration).toContain("and not blueprint.is_snapshot");
    expect(migration).toContain("inserted_snapshots as");
    expect(migration).toContain("set blueprint_version_id = snapshot.id");
    expect(migration).toContain("planning_capability := case when candidate.blueprint_is_snapshot then 'visual_planning' else 'storyboard_planning' end");
    expect(migration).toContain("case when blueprint.is_snapshot then 'visual_planning' else 'storyboard_planning' end");
    expect(migration).toContain("'capability', 'visual_planning'");
    expect(migration).toContain("create trigger freeze_shared_planning_harness_before_insert");
    expect(migration).toContain("create or replace function public.apply_episode_configuration_repair_v2");
    expect(migration).toContain("'分镜规划修复配置必须选择已启用的 Harness'");
    expect(migration).toContain("planning_task.input_snapshot - 'prompt_context'");
  });

  it("视觉素材准备改为 Worker 内部步骤，蓝图只保留静态视觉与分镜配置", () => {
    const migration = readFileSync(internalVisualPreparationMigration, "utf8");

    expect(migration).toContain("and exists (select 1 from public.episodes episode where episode.blueprint_version_id = blueprint.id)");
    expect(migration).toContain("coalesce(blueprint.policy -> 'executors', '{}'::jsonb) - 'visual_planning'");
    expect(migration).toContain("coalesce(blueprint.policy -> 'budgets', '{}'::jsonb) - 'visual_planning_cents'");
    expect(migration).toContain("'visual-preparation-v1'");
    expect(migration).toContain("'execution_mode', case when selected_harness.id is null then 'worker_default' else 'legacy_frozen' end");
    expect(migration).toContain("drop trigger if exists freeze_shared_planning_harness_before_insert on public.tasks;");
  });

  it("全局视觉准备调度复用按生产单编排入口", () => {
    const migration = readFileSync(uploadedVisualDispatchMigration, "utf8");

    expect(migration).toContain("create or replace function public.orchestrate_provided_script_tasks()");
    expect(migration).toContain("public.orchestrate_provided_script_tasks_for_episode(candidate_id)");
    expect(migration).not.toContain("invalid visual planning budget");
    expect(migration).not.toContain("invalid visual planning executor");
  });

  it("视觉准备冻结已批准的上传视频且不要求图片生成配置", () => {
    const migration = readFileSync(uploadedVisualDispatchMigration, "utf8");

    expect(migration).toContain("create or replace function public.orchestrate_provided_script_tasks_for_episode(p_episode_id uuid)");
    expect(migration).toContain("join public.material_revision_approvals approval on approval.material_revision_id = material.id");
    expect(migration).toContain("material.material_purpose in ('visual_reference', 'a_roll', 'b_roll')");
    expect(migration).toContain("'materialPurpose', material.material_purpose");
    expect(migration).toContain("'image_generation', image_generation");
    expect(migration).toContain("'model', candidate.policy #>> '{static_visual,executor,model}'");
  });

  it("按生产单的明确选择决定保留上传视频原声还是生成 TTS", () => {
    const migration = readFileSync(episodeAudioSourceMigration, "utf8");

    expect(migration).toContain("audio_source_mode in ('source', 'tts')");
    expect(migration).toContain("create function public.set_episode_audio_source_mode");
    expect(migration).toContain("episode.audio_source_mode = 'tts'");
    expect(migration).toContain("episode.audio_source_mode = 'source'");
    expect(migration).not.toContain("and not exists (select 1 from public.production_material_revisions material");
  });

  it("让豆包语音旁白进入创建、领取与连接修复链路", () => {
    const migration = readFileSync(volcengineTtsExecutionMigration, "utf8");

    expect(migration).toContain("executor ->> 'provider' = 'volcengine_tts'");
    expect(migration).toContain("'codex','google_tts','volcengine_tts','pexels'");
    expect(migration).toContain("then blocked_task.provider");
    expect(migration).toContain("blocked_task.input_snapshot #>> '{executor,adapter}'");
  });

  it("自动进入审核渲染，并只在 QC 台阻塞最终批准", () => {
    const migration = readFileSync(qcEditorMigration, "utf8");

    expect(migration).toContain("''approval_mode'',''qc_only''");
    expect(migration).toContain("create table public.qc_review_issues");
    expect(migration).toContain("create or replace function public.create_qc_review_issue");
    expect(migration).toContain("create or replace function public.request_qc_member_revision");
    expect(migration).toContain("Open blocking QC issues must be resolved before approval");
  });

  it("自动审核渲染推进状态，并拒绝对陈旧或人工 QC 成员返工", () => {
    const migration = readFileSync(qcEditorCompletionMigration, "utf8");

    expect(migration).toContain("'production_ready','render_ready'");
    expect(migration).toContain("QC review package is no longer current");
    expect(migration).toContain("selected_task.provider = 'manual_upload'");
  });

  it("将 HyperFrames 合成参数迁出蓝图，并冻结系列默认或生产单调整", () => {
    const migration = readFileSync(editingDeskMigration, "utf8");

    expect(migration).toContain("set policy = policy - 'hyperframes_composition'");
    expect(migration).toContain("create or replace function public.save_series_composition_default");
    expect(migration).toContain("coalesce(candidate.series_rules -> 'hyperframes_composition'");
    expect(migration).toContain("create function public.request_review_render_revision(p_review_package_id uuid, p_composition jsonb, p_reason text)");
  });

  it("清除系列高级规则，并让审核渲染只使用系统初始配置或 Studio 修订", () => {
    const migration = readFileSync(removeSeriesAdvancedRulesMigration, "utf8");

    expect(migration).toContain("drop function if exists public.save_series_composition_default(uuid, jsonb)");
    expect(migration).toContain("Series rules must contain only supported creative baseline fields");
    expect(migration).toContain("'系统初始合成配置。'");
    expect(migration).not.toContain("series_rules");
  });

  it("仅允许 Owner 把本地冻结的 Studio 工程提交为审核修订", () => {
    const migration = readFileSync(hyperframesStudioRevisionMigration, "utf8");

    expect(migration).toContain("'studio_project'");
    expect(migration).toContain("'Invalid frozen Studio project'");
    expect(migration).toContain("grant execute on function public.request_review_render_revision(uuid, jsonb, text) to authenticated");
  });

  it("Studio 结构修改会返回分镜返工，而不是直接重渲染", () => {
    const migration = readFileSync(studioStructuralRevisionMigration, "utf8");
    expect(migration).toContain("create function public.request_studio_storyboard_revision");
    expect(migration).toContain("'qc_review', 'visual_approved'");
    expect(migration).toContain("perform public.orchestrate_storyboard_tasks_for_episode(selected_episode.id)");
    expect(migration).toContain("'storyboard_review', 'changes_requested'");
    expect(migration).toContain("selected_pre_render_package.context_snapshot ->> 'storyboard_review_package_id'");
    expect(migration).toContain("grant execute on function public.request_studio_storyboard_revision(uuid, text) to authenticated");
  });

  it("Studio 结构返工不会给已批准的分镜包重复绑定审批记录", () => {
    const migration = readFileSync(studioStructuralReworkApprovalMigration, "utf8");

    expect(migration).not.toContain("insert into public.approvals");
    expect(migration).toContain("'studio_storyboard_revision_requested'");
  });

  it("两类审核修订共享当前包与 Owner 前置条件，但保留各自编排", () => {
    const migration = readFileSync(reviewRevisionPreconditionsMigration, "utf8");

    expect(migration).toContain("create function public.current_hyperframes_review_package");
    expect(migration).toContain("for update");
    expect(migration).toContain("membership_role is distinct from 'owner'");
    expect(migration).toContain("revoke all on function public.current_hyperframes_review_package(uuid, boolean) from public, anon, authenticated");
    expect(migration).toContain("select * into selected_package from public.current_hyperframes_review_package(p_review_package_id, true)");
    expect(migration).toContain("select * into selected_qc_package from public.current_hyperframes_review_package(p_review_package_id, false)");
    expect(migration).toContain("perform public.orchestrate_storyboard_tasks_for_episode(selected_episode.id)");
  });

  it("逐镜头准备草稿只允许 Owner 保存当前已批准分镜的镜头", () => {
    const migration = readFileSync(shotPreparationDraftMigration, "utf8");

    expect(migration).toContain("create table public.shot_preparation_drafts");
    expect(migration).toContain("unique (episode_id, review_package_id, shot_id)");
    expect(migration).toContain("current_episode.stage <> 'storyboard_approved'");
    expect(migration).toContain("membership.role = 'owner'");
    expect(migration).toContain("The shot does not belong to the approved storyboard");
    expect(migration).toContain("on conflict (episode_id, review_package_id, shot_id) do update");
    expect(migration).toContain("seed_shot_preparation_drafts_after_storyboard_approval");
  });

  it("逐镜头 TTS 只在显式请求时创建冻结任务，并在成功后切换版本", () => {
    const migration = readFileSync(shotTtsMigration, "utf8");

    expect(migration).toContain("create function public.generate_shot_tts");
    expect(migration).toContain("p_retry boolean default false");
    expect(migration).toContain("shot_preparation");
    expect(migration).toContain("current_audio_track_id");
    expect(migration).toContain("pending_tts_task_id");
    expect(migration).toContain("sync_shot_tts_audio_after_insert");
    expect(migration).toContain("tts_error");
  });

  it("逐镜头裁剪只在显式请求时创建幂等 Worker 任务，并保留旧片段", () => {
    const migration = readFileSync(shotClipMigration, "utf8");

    expect(migration).toContain("create or replace function public.save_shot_clip_draft");
    expect(migration).toContain("create function public.generate_shot_clip");
    expect(migration).toContain("p_retry boolean default false");
    expect(migration).toContain("ffmpeg_trim_video");
    expect(migration).toContain("pending_video_task_id");
    expect(migration).toContain("current_video_artifact_id");
    expect(migration).toContain("sync_shot_clip_task_after_update");
    expect(migration).toContain("status in ('ready', 'running', 'completed')");
    expect(migration).toContain("where id = draft_id and pending_video_task_id = new.id");
  });

  it("逐镜头原声与无口播模式保留可追溯版本，并在当前片段变化后失效", () => {
    const migration = readFileSync(shotAudioModesMigration, "utf8");

    expect(migration).toContain("track_kind in ('narration', 'source', 'derived', 'bgm', 'sfx')");
    expect(migration).toContain("create function public.generate_shot_source_audio");
    expect(migration).toContain("source_video_artifact");
    expect(migration).toContain("shot_source_audio");
    expect(migration).toContain("audio_mode = 'none'");
    expect(migration).toContain("create trigger invalidate_shot_source_audio_after_clip_change");
    expect(migration).toContain("status = 'superseded'");
    expect(migration).toContain("source_audio_error");
  });

  it("逐镜头确认要求同步证据、显式警告接受，并在输入变化后撤销", () => {
    const migration = readFileSync(shotConfirmationMigration, "utf8");

    expect(migration).toContain("create function public.confirm_shot_preparation");
    expect(migration).toContain("Duration mismatch must be explicitly accepted before confirmation");
    expect(migration).toContain("shot_duration_warning_accepted");
    expect(migration).toContain("create function public.skip_shot_preparation");
    expect(migration).toContain("create trigger reset_shot_preparation_confirmation_after_input_change");
    expect(migration).toContain("confirmation_status = 'confirmed'");
    expect(migration).toContain("create_shot_preparation_review_package");
  });

  it("Studio 只冻结当前确认镜头，并把确认快照传入 HyperFrames", () => {
    const migration = readFileSync(confirmedStudioSnapshotMigration, "utf8");

    expect(migration).toContain("draft.input_fingerprint is distinct from md5(shot::text)");
    expect(migration).toContain("Superseded by the current confirmed storyboard snapshot");
    expect(migration).toContain("'confirmation_mode', candidate.context_snapshot -> 'confirmation_mode'");
    expect(migration).toContain("'confirmed_shots', candidate.context_snapshot -> 'confirmed_shots'");
    expect(migration).toContain("'artifact_id', member.artifact_id");
    expect(migration).toContain("'audio_track_id', member.audio_track_id");
    expect(migration).toContain("'approval_mode', 'qc_only'");
  });
});
