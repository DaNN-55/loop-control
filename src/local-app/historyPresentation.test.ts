import{it,expect}from'vitest';import{historySourcePresentation,historyFilePresentation,historyRecordTitle}from'./historyPresentation';
it('classifies from actual source metadata, with unknown sources kept in diagnostics',()=>{
 expect(historySourcePresentation({id:'a'.repeat(64),kind:'ordinary-template-configuration',label:'raw'})).toEqual({category:'configuration',title:'公开模板配置 · aaaaaaaa'});
 expect(historySourcePresentation({id:'b'.repeat(64),kind:'media',label:'stage-d/fixture/manifest.json'}).category).toBe('diagnostics');
 expect(historySourcePresentation({id:'b'.repeat(64),kind:'media',label:'account-media/manifest.json'}).category).toBe('business');
 expect(historySourcePresentation({id:'b'.repeat(64),kind:'unknown',label:'unknown'}).category).toBe('diagnostics');
});
it('uses concise display names without changing the original identity',()=>{
 const path='old/episodes/12345678-aaaa-4000-8000-123456789012/render.mp4';expect(historyFilePresentation(path,'media')).toEqual({category:'business',title:'视频 · render.mp4'});expect(path).toContain('12345678-aaaa');expect(historyRecordTitle('public.tasks','12345678-aaaa-4000-8000-123456789012')).toBe('任务 · 12345678');
});
