import type {ProductionWorkspace} from './productionWorkspace';

export type WorkspaceExportAction='exportWorkspace'|'completeWorkspaceExport'|'retryWorkspaceDelivery';
interface ReviewActivity {readOnly?:boolean;pending?:boolean;action?:WorkspaceExportAction|null}
type ReviewWorkspace=Pick<ProductionWorkspace,'exports'|'deliveries'|'stale'>;

/** Explain the current output without erasing the availability of older deliveries. */
export function workspaceExportDeliveryState(workspace:ReviewWorkspace,activity:ReviewActivity={}){
 const latest=workspace.exports?.[0],delivery=workspace.deliveries?.[0];
 const running=!!delivery&&['ready','running'].includes(delivery.status);
 const confirmed=!!latest?.confirmed&&latest.current&&!workspace.stale;
 const failed=!!latest&&(latest.status!=='ready'||latest.checks.some(check=>!check.passed));
 const outdated=!!latest&&(!latest.current||workspace.stale);
 const delivered=!!delivery?.verified&&delivery.exportId===latest?.id&&!outdated;
 const unavailable=delivery?.status==='completed'&&!delivery.verified;
 const retryTarget=delivery&&['failed','blocked'].includes(delivery.status)&&delivery.exportId===latest?.id&&confirmed?delivery:null;
 const busyReason=activity.readOnly?'read-only':activity.pending?'pending':activity.action?'operation-pending':running?'delivery-running':null;
 const status=activity.action==='exportWorkspace'?'正在生成成片…':activity.action||running?'正在完成…':outdated?'视频需重新生成':failed?'成片检查未通过':retryTarget?'完成未成功':delivered?'已完成':unavailable?'交付文件不可用':!latest?'待生成成片':confirmed?'待完成':'待确认成片';
 const confirmReason=busyReason??(!latest?'missing-export':outdated?'export-outdated':failed?'checks-failed':!latest.artifact?'missing-file':null);
 return{
  review:{latest,confirmed,failed,outdated,delivered,status,
   tone:delivered?'is-confirmed':outdated||failed||unavailable||retryTarget?'is-failed':'',
   previewMessage:latest?'成片文件尚未就绪。':'生成成片后，在这里观看并确认。',
   nextMessage:outdated?'工程已变化，请重新生成成片。':failed?'请先处理未通过的检查。':'观看画面、声音和字幕，满意后确认完成。',
   exportAction:{label:activity.action==='exportWorkspace'?'正在生成成片…':latest?'重新生成成片':'生成成片',visible:!activity.readOnly&&!running,primary:!latest||outdated||failed,disabledReason:busyReason??(workspace.stale?'workspace-stale':null)},
   confirmAction:{label:activity.action==='completeWorkspaceExport'?'正在完成…':'确认并完成',visible:!!latest&&!delivered&&!running&&!retryTarget&&!activity.readOnly,disabledReason:confirmReason},
  },
  delivery:{latest:delivery,running,retryTarget,unavailable},
 };
}
