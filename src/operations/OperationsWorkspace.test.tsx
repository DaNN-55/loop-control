import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../lib/database.types";
import { OperationsWorkspace } from "./OperationsWorkspace";

type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type ReviewPackage = Database["public"]["Tables"]["review_packages"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];

const series = { account_id: "account-1", created_at: "2026-08-15T00:00:00.000Z", id: "series-1", name: "雨夜志怪", updated_at: "2026-08-15T00:00:00.000Z" } as Database["public"]["Tables"]["series"]["Row"];
const seriesVersion = { account_id: "account-1", created_at: "2026-08-15T00:00:00.000Z", id: "series-version-1", rules: {}, series_id: series.id, version: 2 } as Database["public"]["Tables"]["series_versions"]["Row"];

const episodes: Episode[] = [
  { account_id: "account-1", blueprint_version_id: "blueprint-1", created_at: "2026-08-15T00:00:00.000Z", id: "episode-review", series_version_id: seriesVersion.id, stage: "script_review", title: "脚本待审", updated_at: "2026-08-15T00:00:00.000Z" },
  { account_id: "account-1", blueprint_version_id: "blueprint-1", created_at: "2026-08-15T00:00:00.000Z", id: "episode-blocked", series_version_id: seriesVersion.id, stage: "production_ready", title: "媒体受阻", updated_at: "2026-08-15T00:00:00.000Z" },
  { account_id: "account-1", blueprint_version_id: "blueprint-1", created_at: "2026-08-15T00:00:00.000Z", id: "episode-unassigned", series_version_id: null, stage: "production_completed", title: "无系列生产单", updated_at: "2026-08-15T00:00:00.000Z" },
];

const reviewPackages: ReviewPackage[] = [
  { artifact_id: null, context_snapshot: {}, created_at: "2026-08-15T00:00:00.000Z", episode_id: "episode-review", id: "old-script-review", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "script_review", task_id: "task-old", task_run_id: "run-old" },
  { artifact_id: null, context_snapshot: {}, created_at: "2026-08-15T00:01:00.000Z", episode_id: "episode-review", id: "new-script-review", invalidated_at: null, invalidated_reason: null, revision_number: 2, stage: "script_review", task_id: "task-new", task_run_id: "run-new" },
  { artifact_id: null, context_snapshot: {}, created_at: "2026-08-15T00:01:00.000Z", episode_id: "episode-blocked", id: "stale-visual-review", invalidated_at: null, invalidated_reason: null, revision_number: 1, stage: "visual_review", task_id: "task-stale", task_run_id: "run-stale" },
];

const tasks: Task[] = [{ actual_cost_cents: null, attempt: 0, budget_limit_cents: 0, claimed_at: null, completed_at: null, created_at: "2026-08-15T00:00:00.000Z", episode_id: "episode-blocked", id: "blocked-task", input_snapshot: {}, last_result: { blockers: [{ code: "media_provider_unavailable", detail: "测试媒体适配器未配置。" }] }, max_attempts: 1, model: "", prompt_version: "", provider: "", status: "blocked", task_type: "generate_b_roll" }];

it.each(['per-row blocker','old-response queue fallback'])('explains an unknown narration result in delivery using %s',async source=>{
 const episode={...episodes[1],title:'咖啡两镜头'},open=vi.fn(),queue=vi.fn();
 const catalog={episodes:[episode],page:2,total:21,pageSize:20,episodeCount:21,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:2,total:21,items:[]},worker:{running:0,blocked:1,failed:0,latestCompleted:false},operationRows:[{episodeId:episode.id,reviewRevision:null,reviewPending:false,blockerCount:1,actionStatus:'blocked',workflowStep:'delivery',blocker:{code:'provider_result_unknown',detail:'供应商请求结果未知，请核对请求账本。',taskType:'generate_narration'}}]} as unknown as import('../episodes/episodeCatalogTypes').EpisodeCatalog;
 if(source==='old-response queue fallback'){catalog.blocked.items=[{episode,blocker:catalog.operationRows[0].blocker!}];delete catalog.operationRows[0].blocker;}
 await act(async()=>render(<OperationsWorkspace onOpenTaskQueue={source==='old-response queue fallback'?queue:undefined} remote={{catalog,seriesId:'all',onSeriesChange:vi.fn(),onPageChange:vi.fn(),onPendingPageChange:vi.fn(),onBlockedPageChange:vi.fn()}} episodes={[episode]} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={[]} series={[]} seriesVersions={[]} tasks={[]} onSelectEpisode={open} selectedEpisode={episode}/>));
 const row=within(screen.getByRole('region',{name:'系列生产单'})).getAllByRole('row')[1];
 expect(row.textContent).toContain('检查与交付');expect(row.textContent).toContain('需处理');expect(row.textContent).toContain('口播结果待核对');
 const current=within(screen.getByRole('complementary',{name:'当前作品'}));expect(current.getByText('供应商请求结果未知，请核对请求账本。')).toBeTruthy();
 await userEvent.setup().click(current.getByRole('button',{name:'核对口播结果'}));if(source==='old-response queue fallback'){expect(queue).toHaveBeenCalledOnce();expect(open).not.toHaveBeenCalled();}else expect(open).toHaveBeenCalledWith(episode.id);expect(current.queryByRole('button',{name:'处理交付问题'})).toBeNull();
});

it('preserves server ordering across series instead of regrouping recent episodes',async()=>{
 const ordered=[{...episodes[2],title:'最新作品',updated_at:'2026-11-02T00:00:00Z'},episodes[0],episodes[1]];
 const catalog={episodes:ordered,page:1,total:3,pageSize:20,episodeCount:3,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{page:1,total:0,items:[]},blocked:{page:1,total:0,items:[]},worker:{running:0,blocked:0,failed:0,latestCompleted:false},operationRows:[]} satisfies import('../episodes/episodeCatalogTypes').EpisodeCatalog;
 await act(async()=>{render(<OperationsWorkspace remote={{catalog,seriesId:'all',onSeriesChange:vi.fn(),onPageChange:vi.fn(),onPendingPageChange:vi.fn(),onBlockedPageChange:vi.fn()}} episodes={ordered} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={[]} series={[series]} seriesVersions={[seriesVersion]} tasks={[]} onSelectEpisode={vi.fn()} selectedEpisode={null}/>);});
 const rows=within(screen.getByRole('region',{name:'系列生产单'})).getAllByRole('row').slice(1);
 expect(rows.map(row=>row.textContent)).toEqual([expect.stringContaining('最新作品'),expect.stringContaining('脚本待审'),expect.stringContaining('媒体受阻')]);
});

describe("系列运营视图", () => {
  it("按当前生产单阶段汇总系列，并且不显示统一完成百分比", () => {
    render(<OperationsWorkspace episodes={episodes} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={reviewPackages} series={[series]} seriesVersions={[seriesVersion]} tasks={tasks} onSelectEpisode={vi.fn()} selectedEpisode={null} />);

    expect(screen.getByLabelText("运营系列筛选")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "雨夜志怪" })).toBeNull();
    expect(screen.getAllByText("输入与脚本").length).toBeGreaterThan(0);
    expect(screen.getAllByText("分镜与媒体").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d+%/)).toBeNull();
  });

  it("只计入当前阶段的最新待审包，并可定位待审和阻塞生产单", async () => {
    const user = userEvent.setup();
    const onSelectEpisode = vi.fn();
    render(<OperationsWorkspace episodes={episodes} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={reviewPackages} series={[series]} seriesVersions={[seriesVersion]} tasks={tasks} onSelectEpisode={onSelectEpisode} selectedEpisode={null} />);

    expect(screen.getByText("1 个待审核包")).toBeTruthy();
    expect(document.querySelector(".operations-blocker-list")).toBeNull();
    await user.click(screen.getByRole("button", { name: "脚本待审 输入与脚本 · 审核包 v2" }));
    await user.click(within(screen.getByRole("region",{name:"系列生产单"})).getByRole("button",{name:"媒体受阻 雨夜志怪"}));
    const continuation=within(screen.getByRole("complementary",{name:"当前作品"}));
    expect(continuation.getByText("需处理")).toBeTruthy();
    await user.click(continuation.getByRole("button", { name: "处理阻塞" }));
    expect(onSelectEpisode).toHaveBeenNthCalledWith(1, "episode-review");
    expect(onSelectEpisode).toHaveBeenNthCalledWith(2, "episode-blocked");
  });

  it("通用执行器阻塞从当前作品进入详情，不再重复铺开修复面板", async () => {
    const user = userEvent.setup();
    const onOpenBlueprint = vi.fn(), onSelectEpisode = vi.fn();
    const genericTask = { ...tasks[0], id: "generic-blocked-task", last_result: { blockers: [{ code: "executor_invalid", detail: "执行器 adapter 未配置。" }] } };

    render(<OperationsWorkspace episodes={episodes} onOpenBlueprint={onOpenBlueprint} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={reviewPackages} series={[series]} seriesVersions={[seriesVersion]} tasks={[genericTask]} onSelectEpisode={onSelectEpisode} selectedEpisode={null} />);

    await user.click(within(screen.getByRole("region",{name:"系列生产单"})).getByRole("button",{name:"媒体受阻 雨夜志怪"}));
    await user.click(within(screen.getByRole("complementary",{name:"当前作品"})).getByRole("button",{name:"处理阻塞"}));
    expect(onSelectEpisode).toHaveBeenCalledWith("episode-blocked");
    expect(onOpenBlueprint).not.toHaveBeenCalled();
    expect(document.querySelector(".operations-blocker-list")).toBeNull();
  });

  it("不把自动审核渲染前的冻结包计为待审核，并保留缺失系列关联的生产单", () => {
    const productionEpisode = { ...episodes[1], id: "episode-production", series_version_id: "missing-series-version", stage: "production_ready" as const, title: "预渲染已审核" };
    const productionPackage = { ...reviewPackages[0], context_snapshot: { approval_mode: "qc_only" }, episode_id: productionEpisode.id, id: "pre-render-package", revision_number: 1, stage: "production_ready" as const };
    const member = { artifact_id: null, audio_track_id: null, created_at: "2026-08-15T00:00:00.000Z", evidence_snapshot: {}, id: "pre-render-member", member_key: "shot:shot-01", member_kind: "shot_media", review_package_id: productionPackage.id, source_task_id: "task-media" } as Database["public"]["Tables"]["pre_render_review_members"]["Row"];

    render(<OperationsWorkspace episodes={[productionEpisode]} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[member]} reviewPackages={[productionPackage]} series={[]} seriesVersions={[]} tasks={[]} onSelectEpisode={vi.fn()} selectedEpisode={null} />);

    expect(screen.getByRole("option", { name: "关联系列不可用" })).toBeTruthy();
    expect(screen.getByText("0 个待审核包")).toBeTruthy();
    expect(within(screen.getByRole("region",{name:"系列生产单"})).getByText("制作中")).toBeTruthy();
  });

  it("对系列生产单明细使用分页", async () => {
    const user = userEvent.setup();
    const manyEpisodes = Array.from({ length: 21 }, (_, index) => ({ ...episodes[2], id: `episode-page-${index}`, title: `分页生产单 ${index + 1}` }));

    render(<OperationsWorkspace episodes={manyEpisodes} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={[]} series={[series]} seriesVersions={[seriesVersion]} tasks={[]} onSelectEpisode={vi.fn()} selectedEpisode={null} />);

    const list = within(screen.getByRole("region", { name: "系列生产单" }));
    expect(screen.getByText("第 1 / 2 页 · 共 21 条")).toBeTruthy();
    expect(list.getAllByRole("row").slice(1)).toHaveLength(12);
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(list.getAllByRole("row").slice(1)).toHaveLength(9);
    expect(list.getByText("分页生产单 13", { selector: "strong" })).toBeTruthy();
    expect(list.getByText("分页生产单 21", { selector: "strong" })).toBeTruthy();
    expect(within(screen.getByRole("complementary", { name: "当前作品" })).getByRole("heading", { name: "分页生产单 13" })).toBeTruthy();
  });

  it("默认不把已归档 Episode 纳入运营汇总", () => {
    const archivedEpisode = { ...episodes[0], archived_at: "2026-08-16T00:00:00.000Z", id: "episode-archived-operation", title: "已归档运营" };
    render(<OperationsWorkspace episodes={[...episodes, archivedEpisode]} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={reviewPackages} series={[series]} seriesVersions={[seriesVersion]} tasks={tasks} onSelectEpisode={vi.fn()} selectedEpisode={null} />);

    expect(screen.queryByText("已归档运营")).toBeNull();
  });
});

it('keeps row selection separate from opening the full production order',async()=>{
 const user=userEvent.setup(),open=vi.fn();
 render(<OperationsWorkspace episodes={episodes} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={reviewPackages} series={[series]} seriesVersions={[seriesVersion]} tasks={tasks} onSelectEpisode={open} selectedEpisode={episodes[0]}/>);
 const list=within(screen.getByRole('region',{name:'系列生产单'}));
 await user.click(list.getByRole('button',{name:'媒体受阻 雨夜志怪'}));
 expect(open).not.toHaveBeenCalled();
 expect(within(screen.getByRole('complementary',{name:'当前作品'})).getByRole('heading',{name:'媒体受阻'})).toBeTruthy();
 await user.click(screen.getByRole('button',{name:'查看完整生产单'}));expect(open).toHaveBeenCalledWith('episode-blocked');
});

it('uses catalog callbacks for status, account, search, sort and series without opening an episode',async()=>{
 const user=userEvent.setup(),onSearch=vi.fn(),onStatus=vi.fn(),onAccount=vi.fn(),onSort=vi.fn(),onSeriesChange=vi.fn();
 const catalog={seriesEpisodeCounts:{'series-1':3},pending:{total:1,items:[],page:1},blocked:{total:0,items:[],page:1},worker:{running:0,blocked:0,failed:0},operationRows:[],statusCounts:{all:3,review:1,running:0,blocked:1,done:1},page:1,total:3,stages:{}} as unknown as import('../episodes/episodeCatalogTypes').EpisodeCatalog;
 render(<OperationsWorkspace catalogControls={{query:'',status:'all',sort:'updated',accountId:'',onSearch,onStatus,onAccount,onSort}} remote={{catalog,seriesId:'all',onSeriesChange,onPageChange:vi.fn(),onPendingPageChange:vi.fn(),onBlockedPageChange:vi.fn()}} accounts={[{id:'account-1',name:'当前账号'} as never]} episodes={[]} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={[]} series={[series]} seriesVersions={[seriesVersion]} tasks={[]} onSelectEpisode={vi.fn()} selectedEpisode={null}/>);
 await user.click(screen.getByRole('tab',{name:'待审核 1'}));expect(onStatus).toHaveBeenCalledWith('review');
 await user.type(screen.getByRole('textbox',{name:'搜索标题或编号'}),'  待审{Enter}');expect(onSearch).toHaveBeenCalledWith('待审');
 await user.selectOptions(screen.getByLabelText('工作台账号筛选'),'account-1');expect(onAccount).toHaveBeenCalledWith('account-1');
 await user.selectOptions(screen.getByLabelText('工作台排序'),'title');expect(onSort).toHaveBeenCalledWith('title');
 await user.selectOptions(screen.getByLabelText('运营系列筛选'),'series-1');expect(onSeriesChange).toHaveBeenCalledWith('series-1');
});


it('shows the matching total and opens the full list without selecting a production order',async()=>{
 const user=userEvent.setup(),all=vi.fn(),open=vi.fn();
 render(<OperationsWorkspace episodes={episodes} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={reviewPackages} series={[series]} seriesVersions={[seriesVersion]} tasks={tasks} onOpenAllEpisodes={all} onSelectEpisode={open} selectedEpisode={null}/>);
 expect(screen.getByText('3 张生产单')).toBeTruthy();await user.click(screen.getByRole('button',{name:'查看全部'}));expect(all).toHaveBeenCalledOnce();expect(open).not.toHaveBeenCalled();
});
it('uses the persisted four-step projection for stage, continuation and phase track without changing legacy stage',async()=>{
 const episode={...episodes[0],stage:'script_approved' as const,title:'四步原生工程'};
 const catalog={episodes:[episode],pending:{total:0,items:[],page:1},blocked:{total:0,items:[],page:1},worker:{running:0,blocked:0,failed:0},operationRows:[{episodeId:episode.id,reviewRevision:null,reviewPending:false,blockerCount:0,actionStatus:'running',workflowStep:'editing'}],page:1,total:1,stages:{script_approved:1}} as unknown as import('../episodes/episodeCatalogTypes').EpisodeCatalog;
 await act(async()=>{render(<OperationsWorkspace remote={{catalog,seriesId:'all',onSeriesChange:vi.fn(),onPageChange:vi.fn(),onPendingPageChange:vi.fn(),onBlockedPageChange:vi.fn()}} episodes={[episode]} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={[]} series={[series]} seriesVersions={[seriesVersion]} tasks={[]} onSelectEpisode={vi.fn()} selectedEpisode={episode}/>);});
 expect(within(screen.getByRole('region',{name:'系列生产单'})).getByText('剪辑工作台')).toBeTruthy();expect(within(screen.getByRole('complementary',{name:'当前作品'})).getByRole('button',{name:'继续剪辑'})).toBeTruthy();expect(within(screen.getByRole('list',{name:'当前生产阶段'})).getAllByRole('listitem')).toHaveLength(4);expect(within(screen.getByRole('list',{name:'当前生产阶段'})).getByText('分镜台')).toBeTruthy();expect(episode.stage).toBe('script_approved');
});

it('shows only populated series options using full catalog counts across pages and filters',()=>{
 const catalog={seriesEpisodeCounts:{'series-1':2,unassigned:1},pending:{total:0,items:[],page:1},blocked:{total:0,items:[],page:1},worker:{running:0,blocked:0,failed:0},operationRows:[],page:1,total:0,stages:{}} as unknown as import('../episodes/episodeCatalogTypes').EpisodeCatalog;
 const props={episodes:[],preRenderReviewMemberDecisions:[],preRenderReviewMembers:[],reviewPackages:[],series:[series,{...series,id:'empty',name:'空系列'}],seriesVersions:[seriesVersion],tasks:[],onSelectEpisode:vi.fn(),selectedEpisode:null};
 const remote={catalog,seriesId:'all',onSeriesChange:vi.fn(),onPageChange:vi.fn(),onPendingPageChange:vi.fn(),onBlockedPageChange:vi.fn()};
 const {rerender}=render(<OperationsWorkspace {...props} remote={remote}/>);
 expect(screen.getByRole('option',{name:'雨夜志怪'})).toBeTruthy();
 expect(screen.getByRole('option',{name:'未归属系列'})).toBeTruthy();
 expect(screen.queryByRole('option',{name:'空系列'})).toBeNull();
 expect(screen.queryByRole('option',{name:'关联系列不可用'})).toBeNull();
 rerender(<OperationsWorkspace {...props} remote={{...remote,catalog:{...catalog,seriesEpisodeCounts:{unavailable:1}}}}/>);
 expect(screen.queryByRole('option',{name:'未归属系列'})).toBeNull();
 expect(screen.getByRole('option',{name:'关联系列不可用'})).toBeTruthy();
});

it.each([
 {pending:0,running:0,blocked:0,failed:0,production:0,tone:'success',title:'当前没有待审核项'},
 {pending:2,running:0,blocked:0,failed:0,production:0,tone:'warning',title:'2 项审核，等待你的决定'},
 {pending:0,running:1,blocked:0,failed:0,production:0,tone:'info',title:'内容正在制作中'},
 {pending:0,running:0,blocked:0,failed:0,production:1,tone:'info',title:'内容正在制作中'},
 {pending:0,running:0,blocked:1,failed:0,production:0,tone:'danger',title:'有后台任务需要处理'},
 {pending:0,running:0,blocked:0,failed:1,production:0,tone:'danger',title:'有后台任务需要处理'},
 {pending:2,running:1,blocked:1,failed:1,production:1,tone:'danger',title:'有后台任务需要处理'},
 {pending:2,running:1,blocked:0,failed:0,production:1,tone:'warning',title:'2 项审核，等待你的决定'},
])('uses $tone for pending=$pending, running=$running, blocked=$blocked, failed=$failed, production=$production',async({pending,running,blocked,failed,production,tone,title})=>{
 const openReviews=vi.fn();
 const catalog={pending:{total:pending,items:[],page:1},blocked:{total:0,items:[],page:1},worker:{running,blocked,failed},operationRows:[],statusCounts:{all:0,review:pending,running:production,blocked,done:0},page:1,total:0,stages:{}} as unknown as import('../episodes/episodeCatalogTypes').EpisodeCatalog;
 render(<OperationsWorkspace remote={{catalog,seriesId:'all',onSeriesChange:vi.fn(),onPageChange:vi.fn(),onPendingPageChange:vi.fn(),onBlockedPageChange:vi.fn()}} episodes={[]} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={[]} series={[]} seriesVersions={[]} tasks={[]} selectedEpisode={null} onSelectEpisode={vi.fn()} onOpenReviewQueue={openReviews}/>);
 const notice=screen.getByRole('status');expect(notice.getAttribute('data-tone')).toBe(tone);expect(within(notice).getByText(title)).toBeTruthy();
 if(pending){await userEvent.setup().click(within(notice).getByRole('button',{name:'开始审核'}));expect(openReviews).toHaveBeenCalledOnce();}
 else expect(within(notice).queryByRole('button',{name:'开始审核'})).toBeNull();
 if(blocked+failed)expect(notice.textContent).toContain([blocked&&`${blocked} 项阻塞`,failed&&`${failed} 项失败`].filter(Boolean).join(' · '));
});

it('opens completed work as results and never marks its final stage as still in progress',async()=>{
 const user=userEvent.setup(),open=vi.fn();
 render(<OperationsWorkspace episodes={episodes} preRenderReviewMemberDecisions={[]} preRenderReviewMembers={[]} reviewPackages={reviewPackages} series={[series]} seriesVersions={[seriesVersion]} tasks={tasks} onSelectEpisode={open} selectedEpisode={episodes[0]}/>);
 await user.click(within(screen.getByRole('region',{name:'系列生产单'})).getByRole('button',{name:'无系列生产单 未关联系列'}));
 const result=within(screen.getByRole('complementary',{name:'当前作品'}));
 expect(result.getByRole('heading',{name:'查看成果'})).toBeTruthy();
 expect(result.queryByRole('heading',{name:'继续处理'})).toBeNull();
 expect(result.getByRole('list',{name:'当前生产阶段'}).querySelector('[aria-current="step"]')).toBeNull();
 expect(result.getByRole('region',{name:'制作成果'})).toBeTruthy();
 await user.click(result.getByRole('button',{name:'查看交付包'}));
 expect(open).toHaveBeenCalledWith('episode-unassigned');
});
