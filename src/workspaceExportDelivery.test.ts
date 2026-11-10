import {expect,it} from 'vitest';
import type {ProductionWorkspace} from './productionWorkspace';
import {workspaceExportDeliveryState} from './workspaceExportDelivery';

const base={stale:false,exports:[{id:'export',status:'ready',current:true,confirmed:false,artifact:{relativePath:'final.mp4',sha256:'video',fileSize:12},checks:[]}],deliveries:[],exportIssues:[]} as unknown as ProductionWorkspace;
const confirmed={...base,exports:[{...base.exports![0],confirmed:true}]};
const delivery=(status:string,verified=false)=>({id:'delivery',exportId:'export',taskId:'task',status,verified,error:null,artifacts:[],createdAt:'2026-11-10T00:00:00Z'});
it('uses the current export to offer confirmation before delivery preparation',()=>{
 const state=workspaceExportDeliveryState(base);
 expect(state.review.status).toBe('待确认成片与字幕');expect(state.review.nextMessage).toBe('检查画面与字幕后，确认这份文件。');
 expect(state.review.confirmAction.disabledReason).toBeNull();expect(state.delivery.stage.kind).toBe('locked');expect(state.delivery.stage.message).toBe('确认这份成片后，再设置封面与发布文案。');
});
it.each([
 {name:'no export',workspace:{...base,exports:[]},status:'尚未导出',next:'先导出最终视频，检查后确认这份文件。',reason:'missing-export'},
 {name:'failed export',workspace:{...base,exports:[{...base.exports![0],status:'failed' as const}]},status:'检查未通过',next:'先处理未通过的检查。',reason:'checks-failed'},
 {name:'failed check on ready export',workspace:{...base,exports:[{...base.exports![0],checks:[{name:'file',passed:false,detail:'文件不可用'}]}]},status:'检查未通过',next:'先处理未通过的检查。',reason:'checks-failed'},
 {name:'missing artifact',workspace:{...base,exports:[{...base.exports![0],artifact:null}]},status:'待确认成片与字幕',next:'检查画面与字幕后，确认这份文件。',reason:'missing-file'},
 {name:'unresolved issue',workspace:{...base,exportIssues:[{id:'issue',exportId:'export',reason:'画面需修改',resolved:false}]},status:'有待处理问题',next:'先处理已记录的问题。',reason:'unresolved-issues'},
 {name:'outdated confirmed export',workspace:{...confirmed,exports:[{...confirmed.exports![0],current:false}]},status:'需重新导出',next:'这是旧导出，请先重新导出。',reason:'export-outdated'},
 {name:'stale workspace',workspace:{...confirmed,stale:true},status:'需重新导出',next:'这是旧导出，请先重新导出。',reason:'export-outdated'},
])('keeps review guidance and confirmation gates for $name',row=>{
 const state=workspaceExportDeliveryState(row.workspace);
 expect(state.review.status).toBe(row.status);expect(state.review.nextMessage).toBe(row.next);expect(state.review.confirmAction.disabledReason).toBe(row.reason);
 expect(state.delivery.stage.kind).toBe('locked');expect(state.delivery.coverVisible).toBe(false);
});
it.each([
 {status:'ready',verified:false,view:'running',overview:'正在准备交付',label:'正在准备',message:'交付已排队…',retry:false,exportVisible:true},
 {status:'running',verified:false,view:'running',overview:'正在准备交付',label:'正在准备',message:'正在校验交付文件…',retry:false,exportVisible:true},
 {status:'failed',verified:false,view:'preparation',overview:'成片已确认',label:'交付失败',message:undefined,retry:true,exportVisible:true},
 {status:'blocked',verified:false,view:'preparation',overview:'成片已确认',label:'交付失败',message:undefined,retry:true,exportVisible:true},
 {status:'completed',verified:false,view:'completed',overview:'交付文件需核验',label:'需核验',message:'交付文件需重新核验，请读取原交付状态。',retry:false,exportVisible:false},
 {status:'completed',verified:true,view:'verified',overview:'交付已完成',label:'验证完成',message:undefined,retry:false,exportVisible:false},
])('keeps delivery view and original retry target for $status / verified=$verified',row=>{
 const record=delivery(row.status,row.verified),state=workspaceExportDeliveryState({...confirmed,deliveries:[record]});
 expect(state.review.status).toBe(row.overview);expect(state.review.exportAction.visible).toBe(row.exportVisible);expect(state.delivery.stage.kind).toBe(row.view);expect(state.delivery.status).toBe(row.label);expect(state.delivery.stage.message).toBe(row.message);
 expect(state.delivery.retryAction.target).toBe(row.retry?record:null);
});
it('keeps historical completion independent from the latest failure and current export',()=>{
 const failed=delivery('failed'),history={...delivery('completed',true),id:'history',exportId:'old-export'};
 const state=workspaceExportDeliveryState({...confirmed,deliveries:[failed,history]});
 expect(state.review.status).toBe('交付已完成');expect(state.review.exportAction.visible).toBe(false);expect(state.delivery.stage.kind).toBe('preparation');expect(state.delivery.retryAction.target).toBe(failed);
 const old=workspaceExportDeliveryState({...confirmed,exports:[{...confirmed.exports![0],current:false}],deliveries:[history]});
 expect(old.delivery.stage.kind).toBe('verified');if(old.delivery.stage.kind==='verified')expect(old.delivery.stage.record).toBe(history);
});
it.each([
 {activity:{readOnly:true},reason:'read-only'},
 {activity:{pending:true},reason:'pending'},
 {activity:{action:'recordWorkspaceExportIssue' as const},reason:'operation-pending'},
])('keeps export operations disabled for $reason',row=>{
 const state=workspaceExportDeliveryState(base,row.activity);expect(state.review.exportAction.disabledReason).toBe(row.reason);expect(state.review.confirmAction.disabledReason).toBe(row.reason);
});
it.each([
 {activity:{title:'   ',hasCover:true},reason:'missing-title'},
 {activity:{title:'发布标题',hasCover:false},reason:'missing-cover'},
 {activity:{title:'发布标题',hasCover:true,preparing:true},reason:'delivery-preparing'},
 {activity:{title:'发布标题',hasCover:true,checkingCover:true},reason:'cover-checking'},
 {activity:{title:'发布标题',hasCover:true,pending:true},reason:'pending'},
 {activity:{title:'发布标题',hasCover:true},reason:null},
])('keeps delivery submission disabled reasons without locking editable drafts: $reason',row=>{
 const state=workspaceExportDeliveryState(confirmed,row.activity);expect(state.delivery.prepareAction.disabledReason).toBe(row.reason);
 expect(state.delivery.fieldsDisabledReason).toBe(row.activity.pending?'pending':null);
});
it('does not require a new cover or title when retrying the original failed delivery',()=>{
 const record=delivery('failed'),state=workspaceExportDeliveryState({...confirmed,deliveries:[record]},{preparing:true,checkingCover:true});
 expect(state.delivery.prepareAction.disabledReason).toBe('delivery-preparing');expect(state.delivery.retryAction.target).toBe(record);expect(state.delivery.retryAction.disabledReason).toBeNull();
});
