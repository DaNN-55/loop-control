import {scriptSegments, generationRecords} from './data.js';
const $ = (s, root = document) => root.querySelector(s);
const params = new URLSearchParams(location.search);
const state = { layout: ['A','B','C'].includes(params.get('layout')) ? params.get('layout') : 'B', step: ['preparation','editing','delivery'].includes(params.get('step')) ? params.get('step') : 'preparation', shot: 0, tab: 'visual', prompt: 'brief', modal: null, candidate: 0, promptTask: null };
const shots = [
  { title: '新居空墙', text: '亲戚朋友搬新家，还在纠结送什么？', start: 0, end: 3.07 },
  { title: '挂轴全貌', text: '想送一份能挂在家里、经常看见的心意，就看看这幅日照金山！', start: 3.07, end: 8.73 },
  { title: '金山流水', text: '旭日东升，寓意日子蒸蒸日上；金山流水，寄托财源广进的祝福。', start: 8.73, end: 15.43 },
  { title: '挂轴细节', text: '金色山水配上挂轴造型，送的是一幅画，也是对新生活的一份好盼头。', start: 15.43, end: 21.10 },
  { title: '陈列效果', text: '乔迁、开业，或者送给长辈，都有一份能说出口的好寓意。', start: 21.10, end: 26.20 },
  { title: '祝福收尾', text: '点击视频左下角链接，把这份祝福送到家！', start: 26.20, end: 29.67 },
];
const prompt = '9:16 vertical. Single continuous shot of exactly the same bright new living room in the first frame. The large wall above the sofa stays COMPLETELY EMPTY for the entire video. Locked camera with only an extremely subtle slow push-in. Keep the furniture, plants, window and light unchanged. No artwork, no painting, no scroll, no calligraphy, no frame, no writing, no text, no people, no gift box. Do not create or reveal any objects on the wall. This is an empty-wall establishing shot before the product is shown in the next shot.';
const candidates = [
  { type: '视频', name: '开场旧版本', image: 'empty.png', description: '首帧为空墙，但运动中生成了无关挂画；最终未采用。', task: 'b7f03adf-8b6e-4382-9e69-0c77b433da86', model: 'MiniMax-H3-Lite', duration: '4.46 秒' },
  { type: '图片', name: '空墙首帧', image: 'empty.png', description: '用于开场视频的首帧参考，没有直接用作最终画面。', task: 'a5b4c026-dd12-4867-bc3f-21ca27686ec2', model: 'gpt-image-2.6-sunburst', duration: '864 × 1536' },
  { type: '图片', name: '新居挂轴', image: 'room.png', description: '同一挂轴的新居陈列参考，供产品展示镜头与封面使用。', task: '34caec88-c162-4edb-9dce-73fc236845f2', model: 'gpt-image-2.6-sunburst', duration: '864 × 1536' },
];
const copyText = {
  title: '日照金山｜乔迁送礼（测试）',
  description: '给亲友新居一份长久的祝福，展示同一幅日照金山挂轴及原有题字。本片仅用于生产流程测试，未发布。',
  tags: '#日照金山 #乔迁送礼 #挂轴 #生产测试',
};
const copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const facts = rows => `<dl class="facts">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
const shot = () => shots[state.shot];
const n = index => String(index + 1).padStart(2, '0');
const sec = value => value.toFixed(2);
const audio = (file, label) => `<audio class="audio-player" controls preload="metadata" src="assets/${file}" aria-label="${label}"></audio>`;

function shotNav() {
  if (state.layout === 'C') return overview();
  return `<aside class="shot-nav" aria-label="镜头列表"><div class="shot-list-header"><span>镜头</span><span>口播与素材</span><span>时长</span></div><div class="shot-list">${shots.map((s, i) => `<button class="shot-item" data-shot="${i}" aria-pressed="${i === state.shot}"><span>${n(i)}</span><span class="shot-copy"><span class="shot-caption">${s.text}</span><small>${s.title}</small></span><span class="shot-time">${sec(s.end - s.start)} s</span></button>`).join('')}</div><div class="shot-footer"><span>6 个镜头</span><span class="success">全部已匹配</span></div></aside>`;
}

function overview() {
  return `<div class="overview"><div class="overview-top"><span>一次查看全片；点击镜头查看详情</span><span>1080 × 1920 · 30 fps</span></div><table class="compact-table"><thead><tr><th>镜头</th><th>画面</th><th>口播</th><th>时间线</th><th>声音</th><th></th></tr></thead><tbody>${shots.map((s, i) => `<tr class="${i === state.shot ? 'selected-row' : ''}"><td>${n(i)}</td><td><img class="thumb" src="assets/${i ? 'room' : 'empty'}.png" alt="${s.title}"></td><td>${s.text}</td><td>${sec(s.start)}–${sec(s.end)} s</td><td><span class="success">口播 ✓</span><br><span class="muted">${i === 1 ? '提示音' : i === 2 ? '流水声' : '整期配乐'}</span></td><td><button data-shot="${i}" aria-label="查看镜头 ${n(i)}">查看 ↗</button></td></tr>`).join('')}</tbody></table></div>`;
}

function scene() {
  const s = shot();
  return `<section class="scene" aria-label="当前镜头预览"><div class="scene-heading"><strong>镜头 ${n(state.shot)} · ${s.title}</strong><span class="success">当前采用</span></div><div class="video-stage"><video controls playsinline preload="metadata" poster="assets/${state.shot ? 'room' : 'empty'}.png" src="assets/${state.shot ? 'final' : 'opening'}.mp4" ${state.shot ? `data-seek="${s.start}"` : ''} aria-label="镜头 ${n(state.shot)} 画面预览"></video></div><div class="scene-meta"><span>${sec(s.start)}–${sec(s.end)} s</span><span>${sec(s.end - s.start)} 秒 · 9:16</span></div></section>`;
}

function inspector() {
  const tabs = [['visual', '画面'], ['voice', '字幕与口播'], ['sound', '配乐与声音']];
  return `<section class="inspector" aria-label="镜头属性"><div class="panel-tabs" role="group" aria-label="内容类别">${tabs.map(([key, label]) => `<button data-panel="${key}" aria-pressed="${key === state.tab}">${label}</button>`).join('')}</div><div class="panel-content">${state.step === 'editing' ? editingPanel() : state.tab === 'visual' ? visualPanel() : state.tab === 'voice' ? voicePanel() : soundPanel()}</div></section>`;
}

function visualPanel() {
  return `<div class="section-head"><h3>当前采用</h3><button data-open="source">来源详情 ↗</button></div>${facts([['连接 / 模型', 'MiniMax · H3-Lite'], ['规格', '768P · 竖版'], ['使用区间', `0–${sec(shot().end - shot().start)} 秒`], ['首帧构图', '完整保留']])}<div class="prompt-mini"><div>提示词<span>制作输入与实际提交在同一处查看</span></div><button data-open="prompt">查看 ↗</button></div><div class="candidates-head"><h3>未采用候选 <small>3</small></h3><button data-open="gallery" class="muted">查看全部</button></div><div class="candidate-strip">${candidates.map((c, i) => `<button class="candidate-card" data-candidate="${i}" aria-label="查看${c.type}候选：${c.name}"><img src="assets/${c.image}" alt=""><span>${c.type}<small>${c.name}</small></span></button>`).join('')}</div>`;
}

function voicePanel() {
  const s = shot();
  return `<div class="section-head"><h3>口播</h3><span class="muted">当前采用</span></div><p class="narration">${s.text}</p>${audio('voice-'+n(state.shot)+'.mp3', '镜头 '+n(state.shot)+' 口播试听')}<hr class="rule">${facts([['音色', 'Vivi 2 · 女声'], ['模型', 'seed-tts-2.0'], ['语言 / 语速', '中文 · 1×'], ['音量', '0 dB']])}<div class="caption-preview">${state.shot === 0 ? '亲戚朋友搬新家，' : s.text.slice(0, 14)}</div><div class="inline-summary"><span>跟随口播</span><span>2 行 × 14 字</span><span>minimal</span><span class="success">时序有效</span></div><div class="prompt-mini"><div>字幕时序<span>文字、时间及安全区</span></div><button data-open="captions">查看 ↗</button></div>`;
}

function soundPanel() {
  return `<div class="section-head"><h3>当前使用</h3><button data-open="sound-source">来源与许可 ↗</button></div><div class="sound-row"><div class="sound-top"><h3>整期配乐</h3><small>29.67 秒</small></div>${audio('bgm.mp3', '整期配乐试听')}${facts([['音量', '-18 dB'], ['口播时降低', '10 dB']])}</div><div class="sound-row"><div class="sound-top"><h3>柔和提示音</h3><small>镜头 02 · +0.30 s</small></div>${audio('bell.mp3', '柔和提示音试听')}${facts([['时长', '0.50 秒'], ['音量', '-24 dB']])}</div><div class="sound-row"><div class="sound-top"><h3>流水声</h3><small>镜头 03 · +0.30 s</small></div>${audio('water.mp3', '流水声音效试听')}${facts([['时长', '1.00 秒'], ['音量', '-24 dB']])}</div><p class="sound-license">只显示实际使用的声音；检索词与执行记录收进详情。</p>`;
}

function editingPanel() {
  if (state.tab === 'voice') return voicePanel();
  if (state.tab === 'sound') return soundPanel();
  return `<div class="section-head"><h3>画面配置</h3><span class="muted">镜头 ${n(state.shot)}</span></div><p class="config-subtitle">${shot().text}</p>${facts([['画布', '1080 × 1920 · 30 fps'], ['素材区间', `0–${sec(shot().end - shot().start)} 秒`], ['填充方式', '完整显示'], ['缩放', state.shot === 2 || state.shot === 3 ? '175%' : '100%'], ['位置 X / Y', '0 / 0'], ['旋转', '0°'], ['速度', '1×'], ['转场', '直接切换'], ['淡入 / 淡出', '0 / 0 秒'], ['原片声音', '静音']])}<div class="prompt-mini"><div>原素材与生成记录<span>参数和任务来源按需查看</span></div><button data-open="source">详情 ↗</button></div>`;
}

function delivery() {
  const field = (key, label) => `<section class="copy-field ${key === 'tags' ? 'tags' : ''}" aria-label="${label}"><p class="field-label">${label}</p><p class="field-text">${copyText[key]}</p><button class="copy-button" data-copy="${key}" aria-label="复制${label}" title="复制${label}">${copyIcon}</button></section>`;
  return `<section class="delivery ${state.layout === 'A' ? 'disclosure-view' : state.layout === 'C' ? 'editorial-view' : ''}"><div class="delivery-preview"><video src="assets/final.mp4" poster="assets/empty.png" controls preload="metadata" playsinline aria-label="乔迁最终测试视频"></video></div><div class="delivery-details"><div class="delivery-state"><strong>交付内容</strong><span class="success">✓ 文件验证完成</span></div><div class="delivery-cover"><img src="assets/room.png" alt="日照金山新居挂轴封面"><div><p>日照金山 · 乔迁送礼</p><span class="muted">封面与最终成片已保留</span></div></div>${field('title', '标题')}${field('description', '简介')}${field('tags', '标签')}<div class="delivery-actions"><a class="primary" href="assets/final.mp4" download="乔迁送礼-测试.mp4">↓ 下载视频</a><button data-open="files">交付包 ↗</button><button data-open="files">工程 ↗</button></div><p class="muted">Demo 仅提供视频下载；完整工程与交付包仍在原生产单。</p><details><summary>技术检查 · 6 / 6 通过</summary><p>来源文件、画面覆盖、字幕时序、视频规格、代表帧与最终哈希均已通过。内容质量仍需人工审核。</p></details><details><summary>文件信息与导出历史</summary><p>1080 × 1920 · 30 fps · 29.67 秒<br>当前导出 v32；旧版本与空墙修正前结果保留。</p></details></div></section>`;
}

function render() {
  document.body.dataset.layout = state.layout;
  history.replaceState(null, '', '?layout=' + state.layout + '&step=' + state.step);
  document.querySelectorAll('button[data-layout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === state.layout)));
  document.querySelectorAll('[data-step]').forEach(b => { if (b.dataset.step === state.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  $('#layoutDescription').innerHTML = ({ A: '<strong>A · 双栏检查</strong>保留熟悉的镜头列表，右侧集中预览与信息；调整最小。', B: '<strong>B · 三栏工作台</strong>镜头、画面、属性各有位置；切换内容时保留画面上下文。', C: '<strong>C · 总览与抽屉</strong>先看全片，一次打开一个镜头；详情不拉长页面。' })[state.layout];
  $('#surfaceTitle').textContent = ({ preparation: '分镜台', editing: '已完成工程', delivery: '检查与交付' })[state.step];
  $('#surfaceMeta').textContent = state.step === 'delivery' ? '交付已完成' : state.step === 'editing' ? '选择镜头查看配置' : '6 / 6 画面就绪';
  $('#content').innerHTML = state.step === 'delivery' ? delivery() : `<div class="workspace">${shotNav()}${state.layout === 'C' ? '' : `<div class="detail">${scene()}${inspector()}</div>`}</div>`;
  prepareVideos();
}

function prepareVideos() {
  document.querySelectorAll('video[data-seek]').forEach(v => {
    const seek = () => { v.currentTime = Number(v.dataset.seek); };
    v.addEventListener('loadedmetadata', seek, { once: true });
    if (v.readyState >= 1) seek();
    const end = shot().end;
    v.addEventListener('timeupdate', () => { if (v.currentTime >= end) v.pause(); });
  });
}

function promptBody() {
  const record = generationRecords.find(r => r.taskId === state.promptTask);
  const segment = scriptSegments.find(s => s.id === record?.shotId) ?? scriptSegments[state.shot];
  const currentInput = record?.prompt ?? (state.shot === 0 ? prompt : segment.videoPrompt);
  let body = state.prompt === 'script' ? segment.videoPrompt : state.prompt === 'actual' ? (record?.actualPrompt ?? currentInput) : currentInput;
  return `<div class="prompt-tabs" role="group" aria-label="提示词版本">${[['brief', '制作输入'], ['actual', '实际提交'], ['script', '原脚本']].map(([k, v]) => `<button data-prompt="${k}" aria-pressed="${state.prompt === k}">${v}</button>`).join('')}</div><div class="prompt-text">${escape(body)}</div><p class="note">${state.prompt === 'script' ? '原脚本为中文；英文只出现在修正空墙幻觉的重生请求中，属于手动改写，不是自动翻译。' : state.prompt === 'actual' ? '这是该次请求冻结的完整正文，包含当时追加的构图或账号、系列规则；历史记录保持原样。' : '这是该次请求保存的制作输入，与原脚本分别留存；不是根据当前脚本重新生成的提示词。'}</p>`;
}

function modalBody() {
  if (state.modal === 'shot') return `<div class="drawer-detail">${scene()}${inspector()}</div>`;
  if (state.modal === 'prompt') return promptBody();
  if (state.modal === 'candidate') {
    const c = candidates[state.candidate];
    return `<div class="dialog-media">${c.type === '视频' ? `<video controls preload="metadata" src="assets/old-opening.mp4" poster="assets/${c.image}" aria-label="开场旧版本预览"></video>` : `<img src="assets/${c.image}" alt="${c.name}">`}<div><h3>${c.name}</h3><p>${c.description}</p>${facts([['类型', c.type], ['模型', c.model], ['规格', c.duration], ['采用状态', '未作为当前镜头画面']])}<hr class="rule"><p class="muted">任务 ${c.task}</p><button data-modal-prompt>查看提示词 ↗</button></div></div>`;
  }
  if (state.modal === 'gallery') return `<p class="note">视频与图片放在同一候选区；点击缩略图查看具体参数。</p><div class="candidate-strip">${candidates.map((c, i) => `<button class="candidate-card" data-candidate="${i}"><img src="assets/${c.image}" alt=""><span>${c.type}<small>${c.name}</small></span></button>`).join('')}</div>`;
  if (state.modal === 'source') return `${facts([['连接', 'minimax · v4'], ['模型', 'MiniMax-H3-Lite'], ['请求分辨率', '768P'], ['请求时长', state.shot ? '逐镜头记录' : '4 秒'], ['生成次数', state.shot ? '1 次' : '2 次（含空墙修正）'], ['实际费用', '待供应商账单核实']])}<hr class="rule"><p class="note">原任务 ${state.shot ? '请在正式生产单查看对应记录' : '93ef664e-0482-4077-bec7-07b68b2463d2'}</p><button data-modal-prompt>查看提示词 ↗</button>`;
  if (state.modal === 'captions') return `<div class="narration">${shot().text}</div>${facts([['正文模式', '跟随口播'], ['样式', 'minimal'], ['安全区', '标题安全区'], ['排版上限', '2 行 · 每行 14 字']])}<hr class="rule"><table class="compact-table"><thead><tr><th>镜头内区间</th><th>字幕</th></tr></thead><tbody>${scriptSegments[state.shot].captions.map(c => `<tr><td>${sec(c.start)}–${sec(c.end)} 秒</td><td>${escape(c.text)}</td></tr>`).join('')}</tbody></table><p class="note">时序读取自本次测试单已交付工程。</p>`;
  if (state.modal === 'sound-source') return `${facts([['配乐', 'A ride through chinese valley'], ['来源 / 作者', 'Freesound · neolein'], ['原检索词', 'guzheng instrumental'], ['素材许可', 'CC0'], ['提示音', 'Soft simple bell loop · ZHRØ'], ['流水声', 'river (loop) · radioactive_blueberry']])}<hr class="rule"><p class="note">素材许可与 API 使用许可是两回事；本页仅演示已保留的制作结果，不发起检索调用。</p>`;
  if (state.modal === 'files') return '<ul class="notes-list"><li>最终 MP4</li><li>封面 PNG</li><li>标题、简介与标签</li><li>可编辑工程 JSON</li><li>检查结果及文件清单</li></ul><p class="note">Demo 不连接正式单据下载接口。完整 ZIP 已保存在下载文件夹，工程源素材保留于原账号目录。</p>';
  return '<ol class="notes-list"><li>去除已完成页面重复的画面提示与“制作记录”大标题。</li><li>画面、字幕口播、配乐声音采用一致的预览＋摘要＋详情结构。</li><li>未采用候选合并，参数在点击后显示。</li><li>制作输入、实际提交、原脚本合并到提示词窗口。</li><li>剪辑页一次查看一个镜头，不再纵向铺满六组参数。</li><li>标题、简介、标签分区，复制按钮在悬停或键盘聚焦时显示。</li></ol><p class="note">A 改动最小；B 适合持续制作与审核；C 适合全片核对与批量查看。</p>';
}

function openModal(kind) {
  state.modal = kind;
  const dialog = $('#detailDialog');
  dialog.classList.toggle('drawer', kind === 'shot');
  $('#dialogEyebrow').textContent = kind === 'shot' ? '镜头 ' + n(state.shot) : '制作详情';
  $('#dialogTitle').textContent = ({ shot: shot().title, prompt: '提示词', candidate: '未采用候选', gallery: '未采用候选', source: '当前素材来源', captions: '字幕与时序', 'sound-source': '声音来源与许可', files: '交付文件', notes: '本次调整' })[kind];
  $('#dialogBody').innerHTML = modalBody();
  if (!dialog.open) dialog.showModal();
  prepareVideos();
}

let toastTimer;
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2200);
}

document.addEventListener('click', async event => {
  const b = event.target.closest('button');
  if (!b) return;
  if (b.dataset.layout) { state.layout = b.dataset.layout; render(); }
  else if (b.dataset.step) { state.step = b.dataset.step; render(); }
  else if (b.dataset.shot !== undefined) { state.shot = Number(b.dataset.shot); render(); $(`[data-shot="${state.shot}"]`)?.focus(); if (state.layout === 'C') openModal('shot'); }
  else if (b.dataset.panel) { state.tab = b.dataset.panel; if ($('#detailDialog').open && state.modal === 'shot') { openModal('shot'); $(`#detailDialog [data-panel="${state.tab}"]`)?.focus(); } else { render(); $(`[data-panel="${state.tab}"]`)?.focus(); } }
  else if (b.dataset.open) { state.prompt = 'brief'; state.promptTask = generationRecords.find(r => r.kind === 'video' && r.shotId === scriptSegments[state.shot].id && (state.shot !== 0 || r.taskId === '93ef664e-0482-4077-bec7-07b68b2463d2'))?.taskId; openModal(b.dataset.open); }
  else if (b.dataset.candidate !== undefined) { state.candidate = Number(b.dataset.candidate); openModal('candidate'); }
  else if (b.dataset.prompt) { state.prompt = b.dataset.prompt; $('#dialogBody').innerHTML = promptBody(); $('#dialogBody').querySelector(`[data-prompt="${state.prompt}"]`).focus(); }
  else if (b.hasAttribute('data-modal-prompt')) { if (state.modal === 'candidate') state.promptTask = candidates[state.candidate].task; state.prompt = 'brief'; openModal('prompt'); }
  else if (b.dataset.copy) {
    try { await navigator.clipboard.writeText(copyText[b.dataset.copy]); notify('已复制' + ({ title: '标题', description: '简介', tags: '标签' })[b.dataset.copy]); }
    catch { notify('复制权限不可用，请选中文本复制'); }
  }
  else if (b.id === 'designNotes') openModal('notes');
});
$('#detailDialog').addEventListener('close', () => {
  $('#detailDialog').querySelectorAll('audio,video').forEach(m => m.pause());
  state.modal = null;
});
render();
