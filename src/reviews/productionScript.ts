export type MaterialReference = string;
export interface ProductionSettings {
  aspectRatio?: '9:16' | '16:9' | '1:1';
  voice?: string; speakingRate?: number; language?: string;
  captionsEnabled?: boolean; captionMode?: 'follow_tts' | 'independent';
  captionAnchor?: string; captionSafeArea?: 'title-safe' | 'action-safe';
  captionMaxLines?: number; captionMaxCharacters?: number;
  captionStyle?: 'minimal' | 'cinematic';
  transition?: 'cut' | 'fade' | 'studio';
  layout?: 'full' | '2up-horizontal' | '2up-vertical' | 'pip' | 'grid-4';
  narrationGainDb?: number; bgmGainDb?: number; sfxGainDb?: number;
  bgmDucking?: 'off' | 'light' | 'medium' | 'strong';
  bgm?: MaterialReference; sfx?: MaterialReference; firstFrame?: MaterialReference; cover?: MaterialReference;
  duration?: number; sfxStart?: number; sfxDuration?: number;
  videoReservationCents?: number;
}
export interface ProductionSegment {
  id: string; paragraph: string; narration: string; visual: string;
  videoPrompt: string; shotType: 'a_roll' | 'b_roll'; settings: ProductionSettings; subtitle?: string;
}
export interface ProductionScript {
  version: 2; title: string; settings: ProductionSettings;
  segments: ProductionSegment[]; notes: string[];
}
export class ProductionScriptError extends Error {
  constructor(message: string, public line: number) { super(`第 ${line} 行：${message}`); }
}
const choices = (values: readonly string[]) => (value: string) => {
  if (!values.includes(value)) throw Error(`只能选择 ${values.join(' / ')}`);
  return value;
};
const number = (min: number, max: number, integer = false) => (value: string) => {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw Error('必须填写数字');
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || integer && !Number.isInteger(n)) throw Error(`须为 ${min}～${max} 的${integer ? '整数' : '数字'}`);
  return n;
};
const reference = (value: string) => {
  if (value === '无') return 'none';
  if (value === 'none') return value;
  if (!value || value.length > 200 || /[\\/\x00-\x1f]/.test(value)) throw Error('请填写素材名称，不填写文件路径');
  return value;
};
const fields: Record<string, { key: keyof ProductionSettings; parse: (s: string) => unknown }> = {
  '画幅': { key: 'aspectRatio', parse: choices(['9:16', '16:9', '1:1']) },
  '旁白音色': { key: 'voice', parse: s => s },
  '旁白语速': { key: 'speakingRate', parse: number(0.5, 2) },
  '旁白语言': { key: 'language', parse: s => s },
  '字幕': { key: 'captionsEnabled', parse: s => choices(['开启', '关闭'])(s) === '开启' },
  '字幕正文模式': { key: 'captionMode', parse: choices(['follow_tts', 'independent']) },
  '字幕位置': { key: 'captionAnchor', parse: choices(['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right']) },
  '字幕安全区': { key: 'captionSafeArea', parse: choices(['title-safe', 'action-safe']) },
  '字幕最大行数': { key: 'captionMaxLines', parse: number(1, 2, true) },
  '每行最大字数': { key: 'captionMaxCharacters', parse: number(1, 24, true) },
  '字幕样式': { key: 'captionStyle', parse: choices(['minimal', 'cinematic']) },
  '转场': { key: 'transition', parse: choices(['cut', 'fade', 'studio']) },
  '构图': { key: 'layout', parse: choices(['full','2up-horizontal','2up-vertical','pip','grid-4']) },
  '旁白音量（dB）': { key: 'narrationGainDb', parse: number(-60, 12) },
  '音乐音量（dB）': { key: 'bgmGainDb', parse: number(-60, 12) },
  '音效音量（dB）': { key: 'sfxGainDb', parse: number(-60, 12) },
  '音乐闪避': { key: 'bgmDucking', parse: choices(['off','light','medium','strong']) },
  '背景音乐素材': { key: 'bgm', parse: reference },
  '音效素材': { key: 'sfx', parse: reference },
  '首帧素材': { key: 'firstFrame', parse: reference },
  '封面素材': { key: 'cover', parse: reference },
  '生成时长（秒）': { key: 'duration', parse: number(2, 15, true) },
  '视频费用预留（分/镜头）': { key: 'videoReservationCents', parse: number(1, 100000, true) },
  '音效起点（秒）': { key: 'sfxStart', parse: number(0, 3600) },
  '音效时长（秒）': { key: 'sfxDuration', parse: number(0.01, 3600) },
};
export function isProductionScriptV2(text: string) { return /^-\s*模板版本[：:]\s*2\s*$/m.test(text); }
export function validateProductionDefaults(value:unknown):ProductionSettings {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('系列 production_defaults 必须是对象。');
 const result:Record<string,unknown>={};
 for(const [key,v]of Object.entries(value)){
  const entry=Object.values(fields).find(f=>f.key===key);if(!entry)throw Error('未知系列制作默认字段：'+key);
  if(v==='default'||v==='默认')continue;
  if(!['string','number','boolean'].includes(typeof v))throw Error('系列制作默认值类型无效：'+key);
  result[key]=entry.parse(typeof v==='boolean'?(v?'开启':'关闭'):String(v));
 }
 return result as ProductionSettings;
}
export function parseProductionScript(text: string): ProductionScript | null {
  const version = text.match(/^-\s*模板版本[：:]\s*(\S+)\s*$/m);
  if (!version) return null;
  if (version[1] !== '2') throw new ProductionScriptError('不支持的模板版本', text.slice(0, version.index).split('\n').length);
  const result: ProductionScript = { version: 2, title: '', settings: {}, segments: [], notes: [] };
  let section = '', segment: ProductionSegment | undefined;
  let seen = new Set<string>(), hasSettings = false, hasBody = false;
  const checkSegment = (line: number) => {
    if (!segment) return;
    for (const [field, value] of [['口播',segment.narration],['视频生成提示词',segment.videoPrompt]]) if (!value) throw new ProductionScriptError(`段落 ${segment.paragraph} 缺少${field}`, line);
    if (!seen.has('首帧素材') && !result.settings.firstFrame) throw new ProductionScriptError(`段落 ${segment.paragraph} 缺少首帧素材`, line);
    if ((segment.settings.captionMode ?? result.settings.captionMode) === 'independent' && !seen.has('字幕正文')) throw new ProductionScriptError('独立字幕需要填写字幕正文', line);
  };
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue;
    const title = line.match(/^#\s+(.+)$/);
    if (title) { if (result.title) throw new ProductionScriptError('标题重复',i+1); if(title[1].length>200)throw new ProductionScriptError('标题不能超过 200 字符',i+1); result.title=title[1];continue; }
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      checkSegment(i+1); segment=undefined; section=heading[1]; seen=new Set();
      if (section === '制作设置') { if(hasSettings) throw new ProductionScriptError('制作设置重复',i+1);hasSettings=true; }
      else if(section === '正文') { if(hasBody) throw new ProductionScriptError('正文重复',i+1);hasBody=true; }
      else if(!/^本期补充约束(?:（可选）)?$/.test(section)) throw new ProductionScriptError('未知章节 '+section,i+1);
      continue;
    }
    const paragraph = line.match(/^###\s+段落\s+(\d{2,})$/);
    if (paragraph) {
      if(section!=='正文') throw new ProductionScriptError('段落须位于正文中',i+1);
      checkSegment(i+1);seen=new Set();
      if(result.segments.some(s=>s.paragraph===paragraph[1])) throw new ProductionScriptError('段落编号重复',i+1);
      segment={id:'shot-'+paragraph[1],paragraph:paragraph[1],narration:'',visual:'',videoPrompt:'',shotType:'b_roll',settings:{}};result.segments.push(segment);continue;
    }
    const field = line.match(/^-\s+([^：:]+)[：:]\s*(.*)$/);
    if (!field) throw new ProductionScriptError('请使用模板字段，不使用未标注的长句',i+1);
    const [,name,value] = field;
    if(/^本期补充约束/.test(section)) {
      if(!['制作备注','必须出现','禁止出现'].includes(name)) throw new ProductionScriptError('补充约束仅接受制作备注、必须出现、禁止出现',i+1);
      result.notes.push(`${name}：${value}`);continue;
    }
    if(!segment&&section!=='制作设置') throw new ProductionScriptError('字段须位于制作设置或正文段落中',i+1);
    if(seen.has(name)) throw new ProductionScriptError('字段重复：'+name,i+1);seen.add(name);
    if(!value) throw new ProductionScriptError('字段不能为空；继承时填写“默认”',i+1);
    try {
      if(name==='模板版本'&&!segment) continue;
      if(name==='视频模型') { if(value!=='默认') throw Error('视频模型须沿用已确认执行配置，请填写默认');continue; }
      if(segment&&name==='口播') { segment.narration=value;continue; }
      if(segment&&name==='画面提示') { segment.visual=value;continue; }
      if(segment&&name==='首帧要求') { result.notes.push(`段落 ${segment.paragraph} 首帧要求：${value}`);continue; }
      if(segment&&name==='视频生成提示词') { if(value.length>1500)throw Error('视频生成提示词不能超过 1500 字符');segment.videoPrompt=value;continue; }
      if(segment&&name==='镜头类型') { segment.shotType=choices(['a_roll','b_roll'])(value) as ProductionSegment['shotType'];continue; }
      if(segment&&name==='字幕正文') { segment.subtitle=value;continue; }
      const definition=fields[name];if(!definition)throw Error('未知字段：'+name);
      if(segment&&['bgm','aspectRatio','captionStyle','cover','language'].includes(definition.key))throw Error(name+'只能在制作设置中填写');
      if(value==='默认') continue;
      const target=segment?.settings??result.settings;
      (target as Record<string,unknown>)[definition.key]=definition.parse(value);
    } catch(error) { throw new ProductionScriptError(error instanceof Error?error.message:String(error),i+1); }
  }
  checkSegment(lines.length);
  if(!result.title||!hasSettings||!hasBody||!result.segments.length)throw new ProductionScriptError('须包含标题、制作设置和至少一个正文段落',1);
  if(!/^##\s+制作设置[\s\S]*?^##\s+正文/m.test(text))throw new ProductionScriptError('制作设置须位于正文前',1);
  return result;
}
export function segmentSettings(script: ProductionScript, segment: ProductionSegment): ProductionSettings {
  return {...script.settings,...segment.settings};
}
export const productionScriptTemplate = `# 本期标题

## 制作设置

- 模板版本：2
- 画幅：9:16
- 视频模型：默认
- 视频费用预留（分/镜头）：默认
- 旁白音色：默认
- 旁白语速：默认
- 背景音乐素材：默认
- 字幕：开启
- 字幕正文模式：follow_tts
- 字幕样式：默认
- 字幕位置：bottom-center
- 字幕安全区：title-safe
- 字幕最大行数：2
- 每行最大字数：14
- 转场：cut

## 正文

### 段落 01

- 口播：填写本段完整口播。
- 画面提示：填写画面意图，可使用长句。
- 镜头类型：b_roll
- 首帧素材：填写已上传图片的素材名称
- 视频生成提示词：填写直接提交视频模型的画面与动作描述。
- 生成时长（秒）：默认
- 构图：full
- 音效素材：无

## 本期补充约束（可选）

- 制作备注：补充说明只供审核参考，不作为可执行配置。
`;
