import{createHash}from'node:crypto';
import{mkdtemp,mkdir,readFile,rm,writeFile}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join,dirname}from'node:path';
import{expect,it}from'vitest';
import{buildOpenChatCutProject}from'./openchatcutProject';
import{confirmedTtsRender}from'./openchatcutProject.fixture';
import{renderInputFingerprint,tryReuseRender}from'./renderReuse';
it('工程、素材、音轨、字幕、导出参数任一变化均使复用指纹失效',()=>{
 const render=confirmedTtsRender(),project=buildOpenChatCutProject(render);const fingerprint=renderInputFingerprint(render,project,'openchatcut@0.2.14');
 for(const change of [(r:typeof render)=>{r.members[0].sha256='f'.repeat(64);},(r:typeof render)=>{r.members[1].sha256='e'.repeat(64);},(r:typeof render)=>{r.confirmedShots[0].subtitleText='changed';},(r:typeof render)=>{r.adjustments.width=720;}]){const next=structuredClone(render);change(next);expect(renderInputFingerprint(next,project,'openchatcut@0.2.14')).not.toBe(fingerprint);}
 expect(renderInputFingerprint(render,{...project,activeTimelineId:'changed'},'openchatcut@0.2.14')).not.toBe(fingerprint);
 expect(renderInputFingerprint(render,project,'openchatcut@next')).not.toBe(fingerprint);
});
it('审核来源及指纹一致才复制成片，文件损坏/缺失/参数变化均返回重新渲染且历史不变',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loop-reuse-'));try{
 const render=confirmedTtsRender(),project=buildOpenChatCutProject(render),fingerprint=renderInputFingerprint(render,project,'openchatcut@0.2.14');
 const put=async(artifactType:string,path:string,data:string)=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),data);return{artifactType,relativePath:path,sha256:createHash('sha256').update(data).digest('hex'),fileSize:Buffer.byteLength(data)};};
 const video=await put('review_render_video','episodes/e/review.mp4','controlled-video');
 const sourceProject=await put('review_render_project','episodes/e/project.json',JSON.stringify(project));
 const sourceRuntime=await put('review_render_runtime','episodes/e/runtime.json',JSON.stringify({name:'OpenChatCut',version:'0.2.14'}));
 const sourceQcReport=await put('review_qc_report','episodes/e/qc.json',JSON.stringify({passed:true,renderFingerprint:fingerprint,output:{relativePath:video.relativePath}}));
 const finalRender={sourceReviewPackageId:'review',sourceProject,sourceRuntime,sourceQcReport,projectRelativePath:'episodes/e/final/project.json',projectRevision:1,reviewRender:render};
 const input={root,finalRender,source:{reviewPackageId:'review',inputsMatch:true,video},project,fingerprint,model:'openchatcut@0.2.14',outputRelativePath:'episodes/e/final/final.mp4'};
 expect(await tryReuseRender(input)).toBe(true);expect((await readFile(join(root,video.relativePath))).toString()).toBe('controlled-video');
 expect(await tryReuseRender({...input,fingerprint:'different'})).toBe(false);
 expect(await tryReuseRender({...input,source:{...input.source,inputsMatch:false}})).toBe(false);
 expect(await tryReuseRender({...input,source:{reviewPackageId:'other',inputsMatch:true,video}})).toBe(false);
 await writeFile(join(root,video.relativePath),'corrupt');expect(await tryReuseRender(input)).toBe(false);
 await rm(join(root,video.relativePath));expect(await tryReuseRender(input)).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
