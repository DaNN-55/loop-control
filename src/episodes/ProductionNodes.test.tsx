import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EpisodeProductionView } from './EpisodeProduction';
import { ProductionMaterialPreview, ProductionNodeNavigation, ProductionShotRail, ProductionShotPagination } from './ProductionNodeLayout';
import { clearLocalArtifactCache } from '../reviews/localArtifactPreview';
import type { ComponentProps } from 'react';
vi.mock('../lib/viewTransport', () => ({ viewTransport: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'fixture-token' } }, error: null }) } } }));
const id = '10000000-0000-4000-8000-000000000001', sha = 'a'.repeat(64);
const base: ComponentProps<typeof EpisodeProductionView> = { nodeWorkspace: true, episode: { id, account_id: 'account', blueprint_version_id: 'blueprint', stage: 'waiting_input', title: '真实节点夹具', created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z' }, blueprint: null, artifacts: [], audioTrackAnnotations: [], audioTracks: [], reviewPackages: [], reviewAnnotations: [], tasks: [], transitions: [], isMaterialPending: false, isStoryboardAnnotationPending: false, isTransitionPending: false, onImportMaterial: vi.fn(), onCreateAudioTrackAnnotation: vi.fn(), onCreateStoryboardAnnotation: vi.fn(), onRequestRevision: vi.fn(), onTransition: vi.fn() };
beforeEach(() => { localStorage.clear(); clearLocalArtifactCache(); Element.prototype.scrollIntoView = vi.fn(); vi.stubGlobal('fetch', vi.fn(async (_source: unknown, init?: RequestInit) => init?.method === 'POST' ? Response.json({ url: '/_local-artifact?ticket=fixture' }) : new Response('# 标题\n\n## 正文\n\n真实脚本正文'))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('navigates all six nodes without invoking production commands', async () => {
    const user = userEvent.setup();
    render(<EpisodeProductionView {...base}/>);
    for (const name of ['视觉准备', '分镜审核', '逐镜头制作', '合成与 QC', '交付', '输入与脚本']) {
        await user.click(within(screen.getByRole('tablist', { name: '生产工作流' })).getByRole('tab', { name: new RegExp(name) }));
        expect(document.querySelectorAll('.production-node-panel:not([hidden])')).toHaveLength(1);
    }
    expect(base.onImportMaterial).not.toHaveBeenCalled();
    expect(base.onTransition).not.toHaveBeenCalled();
    expect(base.onRequestRevision).not.toHaveBeenCalled();
});
it('supports keyboard workflow navigation and marks completed nodes without changing stage', async () => {
    const select = vi.fn();
    const user = userEvent.setup();
    render(<ProductionNodeNavigation stage="qc_review" selected="qc" onSelect={select}/>);
    const qc = screen.getByRole('tab', { name: '合成与 QC 当前阶段' });
    await user.click(qc);
    await user.keyboard('{ArrowRight}');
    expect(select).toHaveBeenLastCalledWith('delivery');
    expect(screen.getByRole('tab', { name: '输入与脚本 已完成' }).getAttribute('data-complete')).toBe('true');
});
it('keeps a frozen script read-only, previews its actual Markdown and routes file selection left', async () => {
    const main = { id: 'material-script', episode_id: id, is_main_script: true, material_type: 'script', material_purpose: 'main_script', source_path: 'main-script.md', storage_path: 'episodes/' + id + '/main-script.md', sha256: sha, revision_number: 1, file_size: 30, mime_type: 'text/markdown', created_at: '2026-10-28T00:00:00Z', source_kind: 'file' } as NonNullable<typeof base.materialRevisions>[number];
    render(<EpisodeProductionView {...base} episode={{ ...base.episode, main_script_revision_id: main.id }} materialRevisions={[main]}/>);
    await screen.findByText('真实脚本正文');
    expect(screen.queryByRole('button', { name: '修订主脚本' })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '预览 main-script.md' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(base.onImportMaterial).not.toHaveBeenCalled();
});
it('uses the real script diagnostic and refuses to save invalid edits', async () => {
    const onSave = vi.fn();
    render(<ProductionMaterialPreview material={{ name: 'main-script.md', type: 'script', isMainScript: true, source: '/_local-artifact?fixture=script' }} onSave={onSave}/>);
    await screen.findByText('真实脚本正文');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '修订主脚本' }));
    await user.clear(screen.getByRole('textbox', { name: '主脚本 Markdown 修订' }));
    await user.type(screen.getByRole('textbox', { name: '主脚本 Markdown 修订' }), '缺少标题');
    await user.click(screen.getByRole('button', { name: '保存修订' }));
    expect((await screen.findByRole('alert')).textContent).toContain('第 1 行');
    expect(onSave).not.toHaveBeenCalled();
    await user.clear(screen.getByRole('textbox', { name: '主脚本 Markdown 修订' }));
    await user.type(screen.getByRole('textbox', { name: '主脚本 Markdown 修订' }), '# 修订标题\n\n## 正文\n\n修订正文');
    await user.click(screen.getByRole('button', { name: '保存修订' }));
    expect(onSave).toHaveBeenCalledWith('# 修订标题\n\n## 正文\n\n修订正文');
});
it('rail drag and keyboard request a revision rather than mutating the shot data', async () => {
    const shots = [{ id: 'S01', label: '首镜', duration: 3 }, { id: 'S02', label: '第二镜', duration: 4 }], select = vi.fn(), reorder = vi.fn();
    render(<ProductionShotRail shots={shots} selected="S01" onSelect={select} onReorder={reorder}/>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '查看镜头 S02' }));
    expect(select).toHaveBeenCalledWith('S02');
    await user.click(screen.getByRole('button', { name: '拖动 S01 调整顺序' }));
    await user.keyboard('{ArrowRight}');
    expect(reorder).toHaveBeenCalledWith(['S02', 'S01']);
    expect(shots.map(s => s.id)).toEqual(['S01', 'S02']);
    const transfer = { setData: vi.fn() };
    fireEvent.dragStart(screen.getByRole('button', { name: '拖动 S02 调整顺序' }), { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole('button', { name: '查看镜头 S01' }).closest('.production-shot-tile')!);
    expect(reorder).toHaveBeenLastCalledWith(['S02', 'S01']);
});
it('retains the QC decision draft while browsing other nodes', async () => {
    const episode = { ...base.episode, stage: 'qc_review' as const };
    const artifact = { id: 'qc-render', episode_id: id, artifact_type: 'render', relative_path: 'episodes/' + id + '/render.mp4', sha256: sha, file_size: 20, created_at: '2026-10-28T00:00:00Z', producer_task_id: 'task' };
    const review = { id: 'qc-package', episode_id: id, artifact_id: artifact.id, revision_number: 1, stage: 'qc_review' as const, task_id: 'task', task_run_id: 'run', context_snapshot: {}, created_at: '2026-10-28T00:00:00Z', invalidated_at: null, invalidated_reason: null };
    render(<EpisodeProductionView {...base} episode={episode} artifacts={[artifact]} reviewPackages={[review]}/>);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: '审批理由' }), '留存理由');
    await user.click(screen.getByRole('tab', { name: '输入与脚本 已完成' }));
    await user.click(screen.getByRole('button', { name: '回到当前节点' }));
    expect((screen.getByRole('textbox', { name: '审批理由' }) as HTMLTextAreaElement).value).toBe('留存理由');
    expect(base.onTransition).not.toHaveBeenCalled();
});
it('saves an edited pending script back into the import draft and requires a fresh confirmation', async () => {
    const importMaterial = vi.fn().mockResolvedValue('imported-script'), refresh = vi.fn().mockResolvedValue(undefined), user = userEvent.setup();
    render(<EpisodeProductionView {...base} onImportMaterial={importMaterial} onRefresh={refresh}/>);
    const file = new File(['# 初稿\n\n## 正文\n\n初始正文'], 'fixture-main.md', { type: 'text/markdown' });
    await user.upload(screen.getByLabelText('选择生产材料'), file);
    await user.selectOptions(screen.getByLabelText('fixture-main.md 用途'), 'main_script');
    await waitFor(() => expect(document.querySelector('.production-node-preview')?.textContent).toContain('初始正文'));
    await user.click(screen.getByRole('button', { name: '主脚本待确认：fixture-main.md' }));
    await user.click(screen.getByRole('button', { name: '修订主脚本' }));
    const editor = screen.getByRole('textbox', { name: '主脚本 Markdown 修订' });
    await user.clear(editor);
    await user.type(editor, '# 真实修订\n\n## 正文\n\n保存后的正文');
    await user.click(screen.getByRole('button', { name: '保存修订' }));
    await screen.findByRole('button', { name: '主脚本待确认：fixture-main.md' });
    await user.click(screen.getByRole('button', { name: '导入所选材料' }));
    expect(importMaterial).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '主脚本待确认：fixture-main.md' }));
    await user.click(screen.getByRole('button', { name: '导入所选材料' }));
    await waitForImport();
    expect(new TextDecoder().decode(importMaterial.mock.calls[0][0].content)).toBe('# 真实修订\n\n## 正文\n\n保存后的正文');
    expect(importMaterial.mock.calls[0][0].isMainScript).toBe(true);
    async function waitForImport() { await waitFor(() => expect(importMaterial).toHaveBeenCalledTimes(1)); }
});
it('keeps the legacy script review text and its guarded approval action in the input node', async () => {
    const episode = { ...base.episode, stage: 'script_review' as const }, onTransition = vi.fn().mockResolvedValue(true);
    const artifact = { id: 'script-review-artifact', episode_id: id, artifact_type: 'provided_script', relative_path: 'episodes/' + id + '/review-script.md', sha256: sha, file_size: 80, created_at: '2026-10-28T00:00:00Z', producer_task_id: 'task' };
    const review = { id: 'script-review-package', episode_id: id, artifact_id: artifact.id, revision_number: 1, stage: 'script_review' as const, task_id: 'task', task_run_id: 'run', context_snapshot: { allowed_tools: [], artifact: { relative_path: artifact.relative_path, sha256: artifact.sha256 }, budget: { limit_cents: 90 }, capability: 'script_writing', commission: { creative_direction: '真实方向', core_content: '真实内容' }, executor: { model: 'fixture', provider: 'codex' }, output: { content_type: 'text/markdown', required_artifact_types: ['script'] } }, created_at: '2026-10-28T00:00:00Z', invalidated_at: null, invalidated_reason: null };
    render(<EpisodeProductionView {...base} episode={episode} artifacts={[artifact]} reviewPackages={[review]} onTransition={onTransition}/>);
    await screen.findByText('真实脚本正文');
    expect(screen.getByRole('heading', { name: '审核脚本' })).toBeTruthy();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: '审批理由' }), '已核对真实脚本');
    await user.click(screen.getByRole('button', { name: '批准' }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledWith(id, 'script_approved', '已核对真实脚本'));
});
it('routes rail reorder through the existing reasoned structure revision and preserves generation entrypoints', async () => {
    const episode = { ...base.episode, stage: 'storyboard_approved' as const }, onRequest = vi.fn().mockResolvedValue(undefined), generate = vi.fn();
    const artifact = { id: 'story-artifact', episode_id: id, artifact_type: 'storyboard', relative_path: 'episodes/' + id + '/storyboard.json', sha256: sha, file_size: 200, created_at: '2026-10-28T00:00:00Z', producer_task_id: 'task' };
    const review = { id: 'story-package', episode_id: id, artifact_id: artifact.id, revision_number: 1, stage: 'storyboard_review' as const, task_id: 'task', task_run_id: 'run', context_snapshot: {}, created_at: '2026-10-28T00:00:00Z', invalidated_at: null, invalidated_reason: null };
    const shots = ['S01', 'S02'].map((shot, i) => ({ id: shot, scriptSegment: '镜头文案 ' + shot, shotType: 'a_roll', durationSeconds: 3 + i, productionMethod: '人工', targetSpec: '16:9', inputBasis: [{ relativePath: 'script.md', sha256: sha }] }));
    vi.stubGlobal('fetch', vi.fn(async (_source: unknown, init?: RequestInit) => init?.method === 'POST' ? Response.json({ url: '/_local-artifact?ticket=fixture' }) : Response.json({ version: 'storyboard/v1', shots, audioCues: [] })));
    render(<EpisodeProductionView {...base} episode={episode} artifacts={[artifact]} reviewPackages={[review]} onRequestShotStructureRevision={onRequest} stageActions={<button type="button" onClick={generate}>生成分镜媒体</button>}/>);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: '查看镜头 S01' });
    expect(screen.getByRole('button',{name:'补充镜头'}).textContent).toBe('');
    await user.click(screen.getByRole('button',{name:'折叠镜头列表'}));
    expect(screen.getByRole('region',{name:'分镜工作台'}).getAttribute('data-shot-list-collapsed')).toBe('true');
    expect(screen.queryByRole('button',{name:'补充镜头'})).toBeNull();
    expect(screen.queryByRole('button',{name:'删除镜头'})).toBeNull();
    expect(screen.getByLabelText('共 2 个镜头')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'查看镜头 S02'}));
    expect(screen.getByRole('button',{name:'查看镜头 S02'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button',{name:'展开镜头列表'}).getAttribute('aria-expanded')).toBe('false');
    await user.click(screen.getByRole('button',{name:'查看镜头 S01'}));
    await user.click(screen.getByRole('button',{name:'展开镜头列表'}));
    expect(screen.getByRole('navigation', {name:'镜头确认概览'}).closest('.production-node-context')).toBeTruthy();
    expect(screen.queryByRole('region', {name:'OpenChatCut 审核视频'})).toBeNull();
    expect(screen.getByRole('button',{name:'补充镜头'}).closest('.production-shot-list')).toBeTruthy();
    expect(document.querySelector('.production-node-shot-preview .production-shot-rail')).toBeNull();
    expect(screen.getByRole('region',{name:'S01 结构化构图'}).compareDocumentPosition(screen.getByRole('region',{name:'S01 片段标记'})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByText('更多制作设置'));
    await user.click(screen.getByText('生成与重试'));
    await user.click(screen.getByRole('button', { name: '生成分镜媒体' }));
    expect(generate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('tab',{name:'声音与字幕'}));
    expect(screen.getByRole('textbox',{name:'S01 口播内容'})).toBeTruthy();
    await user.click(screen.getByRole('tab',{name:'画面制作'}));
    await user.click(screen.getByRole('button',{name:'删除镜头'}));
    const deletion=await screen.findByRole('dialog',{name:'S01 删除镜头'});
    expect(onRequest).not.toHaveBeenCalled();
    await user.click(within(deletion).getByRole('button',{name:'关闭镜头设置'}));
    fireEvent.dragStart(screen.getByRole('button', { name: '拖动 S02 调整顺序' }), { dataTransfer: { setData: vi.fn() } });
    fireEvent.drop(screen.getByRole('button', { name: '查看镜头 S01' }).closest('.production-shot-tile')!);
    const dialog = await screen.findByRole('dialog', { name: 'S01 调整顺序' });
    expect((within(dialog).getByRole('textbox', { name: '镜头顺序（逗号分隔）' }) as HTMLInputElement).value).toBe('S02,S01');
    expect(onRequest).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox', { name: '修订原因' }), '先展示第二镜');
    await user.click(within(dialog).getByRole('button', { name: '提交分镜结构修订' }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith({ episodeId: id, reviewPackageId: review.id, reason: '先展示第二镜', operation: { kind: 'reorder', shotIds: ['S02', 'S01'] } }));
    expect(shots.map(s => s.id)).toEqual(['S01', 'S02']);
});
it('keeps the full visual basis available beside its reference gallery', async () => {
    const episode = { ...base.episode, stage: 'visual_review' as const };
    const artifact = { id: 'visual-artifact', episode_id: id, artifact_type: 'visual_brief', relative_path: 'episodes/' + id + '/visual.md', sha256: sha, file_size: 80, created_at: '2026-10-28T00:00:00Z', producer_task_id: 'task' };
    const review = { id: 'visual-package', episode_id: id, artifact_id: artifact.id, revision_number: 2, stage: 'visual_review' as const, task_id: 'task', task_run_id: 'run', context_snapshot: {}, created_at: '2026-10-28T00:00:00Z', invalidated_at: null, invalidated_reason: null };
    render(<EpisodeProductionView {...base} episode={episode} artifacts={[artifact]} reviewPackages={[review]}/>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: '制作依据' }));
    await screen.findByText('真实脚本正文');
    expect(screen.getByText('角色 / 地点 / 关键道具参考组')).toBeTruthy();
    expect(screen.queryByText('所需静态视觉')).toBeNull();
});

it('keeps an unapproved storyboard from opening future shot editing controls', async () => {
    const artifact = { id: 'future-story', episode_id: id, artifact_type: 'storyboard', relative_path: `episodes/${id}/storyboard.json`, sha256: sha, file_size: 200, created_at: '2026-10-28T00:00:00Z', producer_task_id: 'task' };
    const review = { id: 'future-review', episode_id: id, artifact_id: artifact.id, revision_number: 1, stage: 'storyboard_review' as const, task_id: 'task', task_run_id: 'run', context_snapshot: {}, created_at: '2026-10-28T00:00:00Z', invalidated_at: null, invalidated_reason: null };
    render(<EpisodeProductionView {...base} episode={{ ...base.episode, stage: 'storyboard_review' }} artifacts={[artifact]} reviewPackages={[review]} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: '逐镜头制作 待开始' }));
    expect(screen.getByText('分镜审核后，可逐镜头准备素材、声音与构图。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '插入补充镜头' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /口播内容/ })).toBeNull();
    expect(base.onTransition).not.toHaveBeenCalled();
});

it('enlarges the current script in a dismissible dialog and preserves the edit draft on return',async()=>{
 const user=userEvent.setup(),save=vi.fn();
 render(<ProductionMaterialPreview material={{name:'main-script.md',type:'script',isMainScript:true,source:'/_local-artifact?fixture=script'}} onSave={save}/>);
 await screen.findByText('真实脚本正文');
 await user.click(screen.getByRole('button',{name:'修订主脚本'}));
 const text='# 修订标题\n\n## 正文\n\n保留编辑草稿';
 await user.clear(screen.getByRole('textbox',{name:'主脚本 Markdown 修订'}));
 await user.type(screen.getByRole('textbox',{name:'主脚本 Markdown 修订'}),text);
 await user.click(screen.getByRole('button',{name:'放大脚本预览'}));
 const dialog=await screen.findByRole('dialog',{name:'脚本预览放大预览'});
 expect((within(dialog).getByRole('textbox',{name:'主脚本 Markdown 修订'}) as HTMLTextAreaElement).value).toBe(text);
 await user.keyboard('{Escape}');
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect((screen.getByRole('textbox',{name:'主脚本 Markdown 修订'}) as HTMLTextAreaElement).value).toBe(text);
 expect(save).not.toHaveBeenCalled();
});

it('maps internal render stages directly to synthesis and exposes no individual artifact approval',()=>{
 const decide=vi.fn();
 render(<EpisodeProductionView {...base} episode={{...base.episode,stage:'production_ready'}} onReviewPreRenderMember={decide}/>);
 expect(screen.getAllByRole('tab',{name:/当前阶段/})[0].textContent).toContain('合成与 QC');
 expect(screen.queryByRole('tab',{name:/预渲染审核/})).toBeNull();
 expect(screen.queryByRole('button',{name:'批准此项'})).toBeNull();
 expect(decide).not.toHaveBeenCalled();
});
it('reconfirms a persisted script explicitly and preserves edits after cancellation and failure',async()=>{
 const user=userEvent.setup(),save=vi.fn().mockRejectedValueOnce(new Error('版本已变化')).mockResolvedValue(undefined);
 const main={id:'current-script',episode_id:id,is_main_script:true,material_type:'script',material_purpose:'main_script',source_path:'main.md',storage_path:'script.md',sha256:sha,revision_number:2,file_size:30,mime_type:'text/markdown',created_at:'2026-10-29',source_kind:'file'} as NonNullable<typeof base.materialRevisions>[number];
 render(<EpisodeProductionView {...base} episode={{...base.episode,main_script_revision_id:main.id}} materialRevisions={[{...main,id:"old-script",revision_number:1},main]} onReconfirmScript={save}/>);
 await screen.findByText('真实脚本正文');
 await user.click(screen.getByRole('button',{name:'修订主脚本'}));
 const text='# 新标题\n\n## 正文\n\n修订后的正文';
 fireEvent.change(screen.getByRole('textbox',{name:'主脚本 Markdown 修订'}),{target:{value:text}});
 await user.click(screen.getByRole('button',{name:'保存修订'}));
 let dialog=await screen.findByRole('dialog',{name:'确认脚本修订'});
 expect(save).not.toHaveBeenCalled();
 await user.click(within(dialog).getByRole('button',{name:'继续编辑'}));
 expect((screen.getByRole('textbox',{name:'主脚本 Markdown 修订'}) as HTMLTextAreaElement).value).toBe(text);
 await user.click(screen.getByRole('button',{name:'保存修订'}));
 dialog=await screen.findByRole('dialog',{name:'确认脚本修订'});
 await user.type(within(dialog).getByRole('textbox',{name:'脚本修订原因'}),'调整口播');
 await user.click(within(dialog).getByRole('button',{name:'确认新版本'}));
 expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent','版本已变化');
 await user.click(within(dialog).getByRole('button',{name:'确认新版本'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(save).toHaveBeenLastCalledWith({episodeId:id,expectedScriptRevisionId:main.id,text,reason:'调整口播'});
});

it('opens a historical plain main script as a valid editable Markdown draft without changing the stored source',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(_source:unknown,init?:RequestInit)=>init?.method==='POST'?Response.json({url:'/_local-artifact?ticket=plain'}):new Response('历史纯文本正文')));
 const save=vi.fn(),user=userEvent.setup();
 render(<ProductionMaterialPreview material={{name:'main.md',scriptTitle:'本期作品',type:'script',isMainScript:true,source:'/_local-artifact?fixture=plain'}} onSave={save}/>);
 await screen.findByText('历史纯文本正文');await user.click(screen.getByRole('button',{name:'修订主脚本'}));
 expect((screen.getByRole('textbox',{name:'主脚本 Markdown 修订'}) as HTMLTextAreaElement).value).toBe('# 本期作品\n\n## 正文\n\n历史纯文本正文');
 expect(save).not.toHaveBeenCalled();
});

it('脚本格式错误在编辑器上方告警，定位实际行且不触发保存；软换行不改原文',async()=>{
 const user=userEvent.setup(),save=vi.fn().mockResolvedValue(false);
 const source='# 实测标题\n\n## 视频定位\n\n定位内容\n\n## 旁白脚本\n\n原有正文';
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(source)));
 render(<ProductionMaterialPreview material={{name:'script.md',type:'script',isMainScript:true,source:'/_local-artifact?fixture=diagnostic'}} onSave={save}/>);
 await screen.findByText('原有正文');await user.click(screen.getByRole('button',{name:'修订主脚本'}));
 const editor=screen.getByRole('textbox',{name:'主脚本 Markdown 修订'}) as HTMLTextAreaElement;
 await user.click(screen.getByRole('button',{name:'保存修订'}));
 const alert=screen.getByRole('alert');expect(alert.tagName).toBe('DIV');expect(alert.textContent).toContain('第 7 行：缺少“## 正文”');expect(Boolean(alert.compareDocumentPosition(editor)&Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);expect(save).not.toHaveBeenCalled();
 await user.click(within(alert).getByRole('button',{name:'定位'}));expect(editor.value.slice(editor.selectionStart,editor.selectionEnd)).toBe('## 旁白脚本');expect(editor.value).toBe(source);
 const fixed=source.replace('## 旁白脚本','## 正文');fireEvent.change(editor,{target:{value:fixed}});expect(screen.queryByRole('alert')).toBeNull();
 await user.click(screen.getByRole('button',{name:'保存修订'}));expect(save).toHaveBeenCalledWith(fixed);
});

it('把审核包中的冻结上传视频、图片与生成图统一放入视觉参考，制作依据只显示清单',async()=>{
 const video=`episodes/${id}/materials/a-shot-001.mov`,image=`episodes/${id}/materials/reference.png`;
 const artifact={id:'visual-manifest',episode_id:id,artifact_type:'visual_asset_manifest',relative_path:`episodes/${id}/visual-manifest.md`,sha256:sha,file_size:80,created_at:'2026-10-28T00:00:00Z',producer_task_id:'visual-task'};
 const generated={...artifact,id:'generated-image',artifact_type:'static_visual',relative_path:`episodes/${id}/generated.png`};
 const review={id:'visual-frozen-package',episode_id:id,artifact_id:artifact.id,revision_number:2,stage:'visual_review' as const,task_id:'visual-task',task_run_id:'run',context_snapshot:{visual_assets:{external_inputs:[{relativePath:video,sha256:'b'.repeat(64),fileSize:1024},{relativePath:image,sha256:'c'.repeat(64),fileSize:2048}]}},created_at:'2026-10-28T00:00:00Z',invalidated_at:null,invalidated_reason:null};
 render(<EpisodeProductionView {...base} episode={{...base.episode,stage:'visual_review'}} artifacts={[artifact,generated]} reviewPackages={[review]}/>);
 const user=userEvent.setup();
 expect(screen.getByRole('tab',{name:'视觉参考'}).getAttribute('aria-selected')).toBe('true');
 const player=await screen.findByLabelText('a-shot-001.mov');expect(player.tagName).toBe('VIDEO');const videoRequest=vi.mocked(fetch).mock.calls.find(([source])=>String(source).includes(encodeURIComponent(video)));expect(videoRequest).toBeTruthy();expect(String(videoRequest?.[0])).toContain('b'.repeat(64));
 expect(screen.getByRole('button',{name:'reference.png'})).toBeTruthy();expect(screen.getByRole('button',{name:'generated.png'})).toBeTruthy();
 await user.click(screen.getByRole('tab',{name:'制作依据'}));
 const basis=screen.getByRole('tabpanel',{name:'制作依据'});expect(within(basis).getByText('完整资产清单')).toBeTruthy();expect(within(basis).getByText('已冻结外部输入 2 项；已生成视觉资产 1 项。')).toBeTruthy();expect(basis.querySelector('video,img')).toBeNull();expect(within(basis).queryByText('已冻结的外部视觉输入')).toBeNull();
});


it('supports vertical keyboard reordering and add/delete from the formal shot list',async()=>{
 const shots=[{id:'S01',label:'人物展示产品',duration:3},{id:'S02',label:'产品细节特写',duration:4}],reorder=vi.fn(),insert=vi.fn(),remove=vi.fn();
 render(<ProductionShotRail layout="list" shots={shots} selected="S01" onSelect={vi.fn()} onReorder={reorder} onInsert={insert} onDelete={remove}/>);
 const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:'拖动 S01 调整顺序'}));
 await user.keyboard('{ArrowDown}');
 expect(reorder).toHaveBeenCalledWith(['S02','S01']);
 await user.click(screen.getByRole('button',{name:'补充镜头'}));
 await user.click(screen.getByRole('button',{name:'删除镜头'}));
 expect(insert).toHaveBeenCalledTimes(1);expect(remove).toHaveBeenCalledTimes(1);
 expect(shots[0].id).toBe('S01');
});

it('pages storyboards with arrows, jump dots and keyboard, with bounded endpoints', async () => {
    const shots=[{id:'S01',label:'首镜'},{id:'S02',label:'第二镜'},{id:'S03',label:'尾镜'}], select=vi.fn(), user=userEvent.setup();
    const {rerender}=render(<ProductionShotPagination shots={shots} selected="S01" onSelect={select}/>);
    expect((screen.getByRole('button',{name:'上一镜'}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button',{name:'下一镜'}));expect(select).toHaveBeenLastCalledWith('S02');
    rerender(<ProductionShotPagination shots={shots} selected="S02" onSelect={select}/>);
    expect(screen.getByRole('button',{name:'切换到 S02'}).getAttribute('aria-current')).toBe('step');
    await user.click(screen.getByRole('button',{name:'切换到 S03'}));expect(select).toHaveBeenLastCalledWith('S03');
    await user.keyboard('{Home}');expect(select).toHaveBeenLastCalledWith('S01');
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'切换到 S01'}));
    rerender(<ProductionShotPagination shots={shots} selected="S03" onSelect={select}/>);
    expect((screen.getByRole('button',{name:'下一镜'}) as HTMLButtonElement).disabled).toBe(true);
});
