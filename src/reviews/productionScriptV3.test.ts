import {expect,it} from 'vitest';
import {parseProductionScript,parseStoryboardScript} from './productionScript';
import {mainScriptDiagnostic} from './mainScript';
import {storyboardFromScript} from '../worker/scriptPlanning';

const stillScript=`# 静态图片制作

## 制作设置
- 模板版本：3
- 画幅：9:16

## 正文
### 段落 01
- 口播：停下来，看看眼前的光。
- 画面来源：图片
- 素材名称：light.png
- 画面提示：窗边的一束光。
`;

it('reads a versioned static production script without video prompts or first-frame fields',()=>{
 const source=parseProductionScript(stillScript);
 expect(source).toMatchObject({version:3,segments:[{id:'shot-01',visualSource:'image',narration:'停下来，看看眼前的光。',settings:{materialReference:'light.png'}}]});
 expect(source?.segments[0]).not.toHaveProperty('shotType');
 expect(mainScriptDiagnostic(stillScript)).toBeNull();
});

it('reports an invalid structured script instead of silently treating its fields as prose',()=>{
 expect(()=>parseStoryboardScript(stillScript.replace('画面来源：图片','画面来源：不知道'))).toThrow(/画面来源/);
 expect(parseStoryboardScript('# 普通脚本\n\n## 正文\n\n普通正文。')).toBeNull();
});

it.each([['图片','image'],['视频','video'],['已有素材','material'],['暂未选择','unassigned']])('preserves the %s visual choice without authorizing generation', (label,source)=>{
 const parsed=parseProductionScript(stillScript.replace('画面来源：图片','画面来源：'+label))!;
 expect(parsed.segments[0]).toMatchObject({visualSource:source,videoPrompt:''});
 const prepared=storyboardFromScript(parsed,[{artifactType:'main_script',relativePath:'episodes/current/main.md',sha256:'a'.repeat(64),fileSize:20}],{},true);
 expect(prepared.shots[0]).toMatchObject({visualSource:source,materialReference:'light.png'});
});

it('keeps current shot duration separate from provider generation limits and rejects retired classification',()=>{
 expect(parseProductionScript(stillScript+'- 镜头时长（秒）：0.5\n')?.segments[0].settings.duration).toBe(.5);
 expect(()=>parseProductionScript(stillScript+'- 镜头类型：a_roll\n')).toThrow(/当前模板版本不支持字段/);
 expect(()=>parseProductionScript(stillScript.replace('模板版本：3','模板版本：99'))).toThrow(/版本/);
});
