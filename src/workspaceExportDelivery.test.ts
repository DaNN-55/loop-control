import {expect,it} from 'vitest';
import type {ProductionWorkspace} from './productionWorkspace';
import {workspaceExportDeliveryState} from './workspaceExportDelivery';
const base={stale:false,exports:[{id:'export',status:'ready',current:true,confirmed:false,artifact:{relativePath:'final.mp4',sha256:'video',fileSize:12},checks:[]}],deliveries:[]} as unknown as ProductionWorkspace;
const confirmed={...base,exports:[{...base.exports![0],confirmed:true}]};
const delivery=(status:string,verified=false)=>({id:'delivery',exportId:'export',taskId:'task',status,verified,error:null,artifacts:[],createdAt:''});
it('offers final confirmation without publication inputs',()=>{const s=workspaceExportDeliveryState(base);expect(s.review.confirmAction.label).toBe('确认并完成');expect(s.review.confirmAction.disabledReason).toBeNull();expect(s.review.status).toBe('待确认成片');});
it.each([
 {workspace:{...base,exports:[]},status:'待生成成片',reason:'missing-export'},
 {workspace:{...base,exports:[{...base.exports![0],status:'failed' as const}]},status:'成片检查未通过',reason:'checks-failed'},
 {workspace:{...base,exports:[{...base.exports![0],checks:[{name:'file',passed:false,detail:'文件不可用'}]}]},status:'成片检查未通过',reason:'checks-failed'},
 {workspace:{...base,exports:[{...base.exports![0],artifact:null}]},status:'待确认成片',reason:'missing-file'},
 {workspace:{...confirmed,exports:[{...confirmed.exports![0],current:false}]},status:'视频需重新生成',reason:'export-outdated'},
 {workspace:{...confirmed,stale:true},status:'视频需重新生成',reason:'export-outdated'},
])('preserves actual file and content guards: $status',row=>{const s=workspaceExportDeliveryState(row.workspace);expect(s.review.status).toBe(row.status);expect(s.review.confirmAction.disabledReason).toBe(row.reason);});
it.each(['ready','running'])('continues the active completion without a second confirmation: %s',status=>{const s=workspaceExportDeliveryState({...confirmed,deliveries:[delivery(status)]});expect(s.review.status).toBe('正在完成…');expect(s.review.confirmAction.visible).toBe(false);expect(s.delivery.running).toBe(true);});
it.each(['failed','blocked'])('retains original failed completion for retry: %s',status=>{const d=delivery(status),s=workspaceExportDeliveryState({...confirmed,deliveries:[d]});expect(s.delivery.retryTarget).toBe(d);expect(s.review.status).toBe('完成未成功');});
it('does not conceal the newest failure with an earlier success',()=>{const d=delivery('failed'),history={...delivery('completed',true),id:'history',exportId:'old'};const s=workspaceExportDeliveryState({...confirmed,deliveries:[d,history]});expect(s.review.status).toBe('完成未成功');expect(s.delivery.retryTarget).toBe(d);});
it('distinguishes completed history from files that need recovery',()=>{const s=workspaceExportDeliveryState({...confirmed,deliveries:[delivery('completed')]});expect(s.review.status).toBe('交付文件不可用');expect(s.delivery.unavailable).toBe(true);});
it('shows one completed status only for the current verified video',()=>{const s=workspaceExportDeliveryState({...confirmed,deliveries:[delivery('completed',true)]});expect(s.review.status).toBe('已完成');expect(s.review.confirmAction.visible).toBe(false);});
it.each([{readOnly:true},{pending:true},{action:'exportWorkspace' as const}])('locks mutations while busy or read-only',activity=>{const s=workspaceExportDeliveryState(base,activity);expect(s.review.confirmAction.disabledReason).not.toBeNull();expect(s.review.exportAction.disabledReason).not.toBeNull();});
