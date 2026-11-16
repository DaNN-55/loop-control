import {expect,it} from 'vitest';
import {productionRenderPreferences,validateWorkspaceRenderPreferences} from './workspaceRenderPreferences';
import {parseProductionScript,segmentSettings} from './reviews/productionScript';

it('freezes only filled settings, inherits episode timing and retains explicit zero',()=>{
 const script=parseProductionScript('# 模板\n## 制作设置\n- 模板版本：3\n- 音效起点（秒）：0.75\n- 音效时长（秒）：0.5\n## 正文\n### 段落 01\n- 口播：第一段\n- 画面来源：图片\n- 音效起点（秒）：0\n### 段落 02\n- 口播：第二段\n- 画面来源：图片\n- 音效起点（秒）：默认\n')!;
 expect(productionRenderPreferences(segmentSettings(script,script.segments[0]))).toEqual({version:'workspace-render-preferences/v2',sfxStart:0,sfxDuration:.5});
 expect(productionRenderPreferences(segmentSettings(script,script.segments[1]))).toMatchObject({sfxStart:.75,sfxDuration:.5});
 expect(productionRenderPreferences({})).toBeUndefined();
});
it('reads original v1 preferences and validates new timing without accepting unknown extensions',()=>{
 expect(()=>validateWorkspaceRenderPreferences({version:'workspace-render-preferences/v1',voiceGainDb:0,transition:'fade'})).not.toThrow();
 expect(()=>validateWorkspaceRenderPreferences({version:'workspace-render-preferences/v2',sfxStart:0,sfxDuration:.5})).not.toThrow();
 for(const value of [{sfxStart:-1},{sfxDuration:0},{unknown:0}])expect(()=>validateWorkspaceRenderPreferences({version:'workspace-render-preferences/v2',...value})).toThrow();
});
