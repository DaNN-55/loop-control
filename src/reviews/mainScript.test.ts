import {expect,it} from 'vitest';
import {mainScriptDiagnostic} from './mainScript';
it('旧脚本的标题有效时，只定位缺失的正文区块并指出可修改的标题',()=>{
 const script='# 04：地狱 Excel 豆包实测\n\n## 视频定位\n\n定位说明\n\n## 旁白脚本\n\n> 实际口播';
 expect(mainScriptDiagnostic(script)).toBe('第 7 行：缺少“## 正文”区块；可将“## 旁白脚本”改为“## 正文”。');
 expect(mainScriptDiagnostic(script.replace('## 旁白脚本','## 正文'))).toBeNull();
});
it('区分缺少一级标题、缺少正文与正文为空，保留有效标题自由命名',()=>{
 expect(mainScriptDiagnostic('## 正文\n\n口播')).toMatch(/一级标题/);
 expect(mainScriptDiagnostic('# 我的标题\n\n## 说明\n\n内容')).toMatch(/缺少“## 正文”/);
 expect(mainScriptDiagnostic('# 我的标题\n\n## 正文\n\n')).toBe('第 3 行：“## 正文”下没有内容，请填写正文。');
 expect(mainScriptDiagnostic('# 我的标题\n\n## 正文\n\n口播')).toBeNull();
});
it('rejects new v2 writes with an upgrade message while the history parser remains available',async()=>{
 const text='# 历史\n## 制作设置\n- 模板版本：2\n## 正文\n### 段落 01\n- 口播：历史口播\n- 首帧素材：无\n- 视频生成提示词：历史画面\n';
 expect(mainScriptDiagnostic(text)).toMatch(/版本 3/);
 const {parseProductionScript}=await import('./productionScript');expect(parseProductionScript(text)?.version).toBe(2);
});
