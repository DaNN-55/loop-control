import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {parseProductionScript,productionScriptTemplate,validateProductionDefaults} from './productionScript';
import {mainScriptDiagnostic} from './mainScript';
import {resolveProductionPlan,resolveProductionMaterial,type ProductionMaterial} from './productionPlan';
const text=productionScriptTemplate.replace('填写已上传图片的素材名称','客厅首帧');
describe('production script v2',()=>{
 it('omits obsolete classification in new scripts but reads explicit legacy scripts',()=>{expect(productionScriptTemplate).not.toContain('镜头类型');expect(parseProductionScript(text)?.segments[0]).not.toHaveProperty('shotType');expect(parseProductionScript(text.replace('### 段落 01','### 段落 01\n- 镜头类型：a_roll'))?.segments[0].shotType).toBe('a_roll');});
 it('keeps legacy scripts readable and validates typed scripts',()=>{expect(parseProductionScript('# 标题\n\n## 正文\n口播')).toBeNull();expect(mainScriptDiagnostic('# 标题\n\n## 正文\n口播')).toBeNull();expect(parseProductionScript(text)?.segments[0]).toMatchObject({id:'shot-01',videoPrompt:'填写直接提交视频模型的画面与动作描述。',settings:{firstFrame:'客厅首帧',sfx:'none'}});});
 it.each([
  [text.replace('模板版本：2','模板版本：3'),'版本'],
  [text.replace('- 构图：full','- 构图：随意摆放'),'只能选择'],
  [text.replace('- 转场：cut','- 转场：淡淡地转过去'),'只能选择'],
  [text.replace('- 字幕最大行数：2','- 字幕最大行数：20'),'1～2'],
  [text.replace('- 旁白语速：默认','- 旁白语速：0'),'0.5～2'],
  [text.replace('- 音效素材：无','- 音效素材：../test.wav'),'素材名称'],
  [text.replace('- 构图：full','- 构图：full\n- 构图：pip'),'重复'],
  [text.replace('- 构图：full','- 不认识的配置：full'),'未知字段'],
  [text.replace('- 首帧素材：客厅首帧',''),'缺少首帧素材'],
  [text.replace('- 视频生成提示词：填写直接提交视频模型的画面与动作描述。',''),'缺少视频生成提示词'],
  [text.replace('follow_tts','independent'),'独立字幕'],
 ])('rejects invalid fields with a line diagnostic', (input,expected)=>{expect(()=>parseProductionScript(input)).toThrow(expected);expect(mainScriptDiagnostic(input)).toMatch(/第 \d+ 行/);});
 it('does not interpret free video prompts as selectable parameters',()=>{const prompt='镜头缓慢靠近挂轴，保持原有题字；不增加人物：画面光线稳定。';expect(parseProductionScript(text.replace('填写直接提交视频模型的画面与动作描述。',prompt))?.segments[0].videoPrompt).toBe(prompt);});
 it('distinguishes inherited values, disabled values and explicit overrides',()=>{const p=resolveProductionPlan(text,{voice:'series-voice',sfx:'default-water',transition:'fade'},[], 'current',null);expect(p.segments[0].settings.voice).toBe('series-voice');expect(p.segments[0].settings.transition).toBe('cut');expect(p.segments[0].sfx.status).toBe('none');});
 it('validates defaults instead of accepting arbitrary settings',()=>{expect(validateProductionDefaults({voice:'known',speakingRate:1,captionsEnabled:false})).toEqual({voice:'known',speakingRate:1,captionsEnabled:false});expect(()=>validateProductionDefaults({transition:'magic'})).toThrow();expect(()=>validateProductionDefaults({credential_ref:'secret'})).toThrow();});
 it('parses all six delivery scripts and all 36 video prompts',()=>{const root='docs/production-tests/rizhao-jinshan-20261028/scripts/';const scripts=readdirSync(root).filter(f=>/^0[1-6]-.*\.md$/.test(f)).map(f=>parseProductionScript(readFileSync(root+f,'utf8'))!);expect(scripts).toHaveLength(6);expect(scripts.flatMap(s=>s.segments)).toHaveLength(36);expect(scripts.every(s=>s.settings.bgm==='日照金山-BGM-01'&&s.settings.transition==='cut')).toBe(true);});
});
const material=(overrides:Partial<ProductionMaterial>={}):ProductionMaterial=>({id:'material-a',episodeId:'current',seriesId:'series',name:'actor.png',alias:'客厅首帧',type:'image',purpose:'visual_reference',mime:'image/png',path:'episodes/current/materials/a.png',sha256:'a'.repeat(64),size:100,...overrides});
describe('uploaded material matching',()=>{
 it('prefers the current episode and accepts a filename with extension',()=>{const m=material();const result=resolveProductionMaterial('客厅首帧.png','image',[m,material({id:'old',episodeId:'other',sha256:'b'.repeat(64)})],'current','series');expect(result.material?.id).toBe(m.id);});
 it('never borrows a different series, and never guesses an ambiguous match',()=>{expect(resolveProductionMaterial('客厅首帧','image',[material({episodeId:'other',seriesId:'different'})],'current','series').status).toBe('missing');const candidates=[material(),material({id:'second',sha256:'b'.repeat(64)})];expect(resolveProductionMaterial('客厅首帧','image',candidates,'current','series').status).toBe('ambiguous');expect(resolveProductionMaterial('客厅首帧','image',candidates,'current','series','second').material?.id).toBe('second');expect(resolveProductionMaterial('客厅首帧','image',candidates,'current','series','foreign').status).toBe('ambiguous');});
 it('does not treat dotted material names as arbitrary file extensions',()=>{expect(resolveProductionMaterial('scene.02','image',[material({alias:'scene.01'})],'current','series').status).toBe('missing');});
 it('checks purpose and type and honors explicit no sound',()=>{expect(resolveProductionMaterial('music','sfx',[material({type:'audio',purpose:'background_music',alias:'music'})],'current','series').status).toBe('missing');expect(resolveProductionMaterial('none','sfx',[],'current',null).status).toBe('none');});
});
