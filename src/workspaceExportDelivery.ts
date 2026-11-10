import type {ProductionWorkspace} from './productionWorkspace';

export type WorkspaceExportAction='exportWorkspace'|'confirmWorkspaceExport'|'recordWorkspaceExportIssue'|'resolveWorkspaceExportIssue';
interface ReviewActivity {
 readOnly?:boolean;pending?:boolean;action?:WorkspaceExportAction|null;
 preparing?:boolean;checkingCover?:boolean;title?:string;hasCover?:boolean;
}
type ReviewWorkspace=Pick<ProductionWorkspace,'exports'|'exportIssues'|'deliveries'|'stale'>;

/** Read-only UI decisions. Historical completion and latest delivery are distinct authorities. See ADR-0035. */
export function workspaceExportDeliveryState(workspace:ReviewWorkspace,activity:ReviewActivity={}){
 const latest=workspace.exports?.[0],issues=workspace.exportIssues??[],blocked=issues.some(issue=>!issue.resolved);
 const completed=!!workspace.deliveries?.some(delivery=>delivery.status==='completed'),delivered=!!workspace.deliveries?.some(delivery=>delivery.verified);
 const delivery=workspace.deliveries?.[0],running=!!delivery&&['ready','running'].includes(delivery.status),deliveryCompleted=delivery?.status==='completed';
 const confirmed=!!latest?.confirmed&&latest.current&&!workspace.stale;
 const failed=!!latest&&(latest.status!=='ready'||latest.checks.some(check=>!check.passed)),outdated=!!latest&&(!latest.current||workspace.stale);
 const status=activity.action==='exportWorkspace'?'正在导出与检查…':delivered?'交付已完成':completed?'交付文件需核验':running?'正在准备交付':!latest?'尚未导出':outdated?'需重新导出':failed?'检查未通过':confirmed?'成片已确认':blocked?'有待处理问题':'待确认成片与字幕';
 const previewMessage=latest?'最终文件尚未就绪。':'先导出最终视频，检查后确认这份文件。';
 const nextMessage=!latest?previewMessage:outdated?'这是旧导出，请先重新导出。':failed?'先处理未通过的检查。':blocked?'先处理已记录的问题。':'检查画面与字幕后，确认这份文件。';
 const busyReason=activity.readOnly?'read-only':activity.pending?'pending':activity.action?'operation-pending':null;
 const confirmReason=busyReason??(!latest?'missing-export':outdated?'export-outdated':failed?'checks-failed':!latest.artifact?'missing-file':blocked?'unresolved-issues':null);
 const fieldReason=activity.pending?'pending':!confirmed?'export-unconfirmed':null;
 const prepareReason=activity.pending?'pending':activity.preparing?'delivery-preparing':activity.checkingCover?'cover-checking':!confirmed?'export-unconfirmed':!activity.title?.trim()?'missing-title':!activity.hasCover?'missing-cover':null;
 const stage=delivery?.verified?{kind:'verified' as const,record:delivery}
  :running?{kind:'running' as const,record:delivery,message:delivery.status==='running'?'正在校验交付文件…':'交付已排队…'}
  :deliveryCompleted?{kind:'completed' as const,record:delivery,message:delivery.error||'交付文件需重新核验，请读取原交付状态。'}
  :!confirmed?{kind:'locked' as const,message:!latest?'导出并确认成片后，再设置封面与发布文案。':!latest.current||workspace.stale?'工程已变化，请重新导出并确认成片。':'确认这份成片后，再设置封面与发布文案。'}
  :{kind:'preparation' as const};
 return{
  review:{latest,issues,blocked,completed,delivered,confirmed,failed,outdated,status,nextMessage,previewMessage,
   tone:confirmed||delivered?'is-confirmed':outdated||failed?'is-failed':'',
   exportAction:{visible:!completed,label:activity.action==='exportWorkspace'?'正在导出与检查…':latest?'重新导出视频':'导出视频',disabledReason:busyReason??(workspace.stale?'workspace-stale':null)},
   confirmAction:{label:activity.action==='confirmWorkspaceExport'?'正在确认…':'确认成片与字幕',disabledReason:confirmReason},
  },
  delivery:{latest:delivery,running,stage,confirmed,coverVisible:stage.kind==='preparation',fieldsDisabledReason:fieldReason,
   status:delivery?.verified?'验证完成':running?'正在准备':deliveryCompleted?'需核验':delivery&&['failed','blocked'].includes(delivery.status)?'交付失败':!latest?'尚未开始':confirmed?'可准备':'待确认',
   prepareAction:{label:'生成并验证交付包',disabledReason:prepareReason},
   retryAction:{target:stage.kind==='preparation'&&delivery&&['failed','blocked'].includes(delivery.status)?delivery:null,disabledReason:fieldReason},
  },
 };
}
