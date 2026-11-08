import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {LocalEpisodeDetail} from './LocalEpisodeDetail';
import type {ProductionWorkspace} from '../productionWorkspace';

afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it.each(['episode','catalog'])('上传已成功后 %s 刷新失败，仍保留素材回执并完成候选登记',async(failure)=>{
 const episodeId=`refresh-${failure}`;
 const snapshot={episode:{id:episodeId,account_id:'account',title:'上传回执验证',stage:'storyboard_approved',archived_at:null,main_script_revision_id:'script'},blueprint:null,seriesVersion:null,materialRevisions:[],audioTracks:[],tasks:[],taskRuns:[],artifacts:[],reviewPackages:[],transitions:[],preRenderReviewMembers:[],preRenderReviewMemberDecisions:[],audioTrackAnnotations:[],connectionVersions:[],qcReviewIssues:[],reviewAnnotations:[],shotPreparationDrafts:[],storyboardAudioSelections:[]};
 let workspace={id:`workspace-${episodeId}`,episodeId,revision:1,workflowVersion:'four-step/v1',scriptRevisionId:'script',clips:[{id:'clip',itemId:'target',shotId:'shot',text:'镜头',source:null}],visualCandidates:[],visualTasks:[],visualTargets:[],selectedImages:[],narration:[],stale:false,project:{relativePath:'project.json',sha256:'sha',fileSize:1,projectId:'project'},readiness:{deliverable:false,placeholders:['target'],missingSources:[]},history:[]} as unknown as ProductionWorkspace;
 let imports=0;
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'upload-receipt-csrf'});
  if(path.endsWith('/connections'))return Response.json({serviceCatalog:{groups:[]}});
  if(path.includes('/workspace/project?'))return Response.json({project:null});
  if(path.endsWith('/workspace'))return Response.json({workspace});
  if(path.includes('?known='))return imports&&failure==='episode'?Response.json({error:'生产单刷新暂时失败。'},{status:503}):Response.json({hashes:{},sections:snapshot});
  if(init?.method==='POST'){
   const body=JSON.parse(String(init.body)) as {command:string;data:Record<string,string>};
   if(body.command==='importMaterial'){imports++;return Response.json({id:'material',source_path:'receipt.png',storage_path:'media/receipt.png',material_type:'image'});}
   if(body.command==='registerWorkspaceVisualCandidate'){
    workspace={...workspace,revision:2,visualCandidates:[{id:'candidate',targetItemId:'target',materialRevisionId:'material',kind:'image',relativePath:'media/receipt.png',sha256:'sha',status:'available',durationSeconds:3,currentDurationSeconds:3} as NonNullable<ProductionWorkspace['visualCandidates']>[number]]};
    return Response.json(workspace);
   }
   throw Error(`Unexpected command ${body.command}`);
  }
  throw Error(`Unexpected request ${path}`);
 }));
 render(<LocalEpisodeDetail episodeId={episodeId} onClose={()=>{}} onChanged={()=>{if(imports&&failure==='catalog')throw Error('列表刷新暂时失败。');return Promise.resolve();}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'本期素材 · 0'}));
 fireEvent.change(screen.getByLabelText('上传制作素材'),{target:{files:[new File(['fixture'],'receipt.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'预览 receipt.png'}));
 fireEvent.click(screen.getByRole('button',{name:'拖入图片加入候选'}));
 await waitFor(()=>expect(screen.getAllByRole('button',{name:/预览图片候选/})).toHaveLength(1));
 expect(screen.getByRole('alert').textContent).toContain('操作已完成，页面信息更新失败');
 expect(screen.queryByRole('button',{name:'重试未完成项'})).toBeNull();
 expect(imports).toBe(1);
});
