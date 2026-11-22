import {expect,it} from 'vitest';
import {productionCatalogScriptPreview} from './productionCatalogPreview';

const script='# 晨光\n\n## 制作设置\n- 模板版本：3\n- 画幅：9:16\n- 旁白音色：默认\n\n## 正文\n### 段落 01\n- 口播：光落在窗边。\n- 画面来源：图片\n- 画面提示：清晨的窗户。\n- 镜头时长（秒）：10\n### 段落 02\n- 口播：把祝福留在日常。\n- 画面来源：视频\n';

it('shows authored body content instead of template settings and keeps original parameters separate',()=>{
 const preview=productionCatalogScriptPreview(script);
 expect(preview.summary).toBe('光落在窗边。\n\n把祝福留在日常。');
 expect(preview.settings).toEqual([{label:'画幅',value:'9:16'},{label:'旁白音色',value:'默认'}]);
});
it('reads ordinary scripts without assuming they use the structured template',()=>{
 expect(productionCatalogScriptPreview('# 手写稿\n\n## 正文\n\n第一段。\n\n第二段。').summary).toBe('第一段。\n\n第二段。');
 expect(productionCatalogScriptPreview('一份没有标题的原文。').summary).toBe('一份没有标题的原文。');
});
it('keeps readable body text when an old template is incomplete',()=>{
 const incomplete=script.replace('- 画面来源：图片','- 未知设置：旧值');
 expect(productionCatalogScriptPreview(incomplete).summary).toBe('光落在窗边。\n\n把祝福留在日常。');
});
it('bounds long summaries without splitting a unicode character',()=>{
 const preview=productionCatalogScriptPreview('🌄'.repeat(400));
 expect(Array.from(preview.summary)).toHaveLength(241);
 expect(preview.summary.endsWith('🌄…')).toBe(true);
 expect(productionCatalogScriptPreview('  ').summary).toBe('');
});
it('keeps a multi-paragraph script preview short without changing the source',()=>{
 expect(productionCatalogScriptPreview('第一段。\n\n第二段。\n\n第三段。').summary).toBe('第一段。\n\n第二段。…');
});
