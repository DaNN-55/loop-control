export const historyCategories=[{id:'business',label:'业务资料'},{id:'configuration',label:'配置与模板'},{id:'diagnostics',label:'测试与诊断'}] as const;
export type HistoryCategory=typeof historyCategories[number]['id'];
export interface HistorySource {id:string;kind:string;label:string;imported_at:string;rows:string;files:string;archived_at:string|null;category:HistoryCategory;title:string}
const sourceKinds:Record<string,string>={postgres:'数据库快照','postgres-text':'数据库记录','n8n-snapshot':'旧自动化快照','n8n-runtime':'旧自动化运行记录','json-snapshot':'运行阶段快照','cloud-final':'云端最终记录','media':'媒体资料','media-image':'媒体卷资料','source-tree':'源码差异','source-archive':'源码归档','retired-archive':'旧环境归档','retired-files':'旧文件','vm-recovery':'虚拟机恢复记录','retained-restore':'恢复验收记录','backup-metadata':'历史清单','backup-cleanup-evidence':'清理核验资料','maintenance-cleanup':'历史清理资料','ordinary-template-configuration':'公开模板配置','ordinary-history-literals':'普通历史配置'};
export function historySourcePresentation(source:{id:string;kind:string;label:string}){
 const {kind,label,id}=source;
 const category:HistoryCategory=kind.startsWith('ordinary-')?'configuration':/stage-[a-z]|验收|fixture|negative|test|t\d{2}[_-]/i.test(label)||!['media','media-image','cloud-final'].includes(kind)?'diagnostics':'business';
 const stage=label.match(/stage-([a-z])/i)?.[1]?.toUpperCase();
 const context=stage?`Stage ${stage}`:label.includes('VM故障')?'VM 恢复':kind==='maintenance-cleanup'?'旧账号与生产单':'';
 const title=[context,sourceKinds[kind]??'历史资料',id.slice(0,8)].filter(Boolean).join(' · ');
 return {category,title};
}
const tableNames:Record<string,string>={accounts:'账号',account_blueprint_versions:'蓝图',series:'系列',series_versions:'系列规则',episodes:'生产单',tasks:'任务',artifacts:'产物',audit_events:'审计事件',external_connections:'连接',external_connection_versions:'连接版本',task_runs:'执行记录',review_packages:'审核包',state_transitions:'状态变更',audio_tracks:'音轨',prompt_versions:'提示词'};
export function historyRecordTitle(table:string,label:string){const kind=tableNames[table.split('.').at(-1)??'']??'历史记录';return `${kind} · ${/^[a-f0-9-]{36}$/i.test(label)?label.slice(0,8):label}`;}
export function historyFilePresentation(path:string,kind:string){
 const parts=path.split('/'),name=parts.at(-1)??path,extension=name.includes('.')?name.split('.').at(-1)!.toLowerCase():'';
 const category:HistoryCategory=kind.startsWith('ordinary-')||/\.(?:env|toml|ini|conf)$/i.test(name)?'configuration':['mp4','mov','webm','mp3','wav','m4a','png','jpg','jpeg','webp','srt','vtt'].includes(extension)?'business':'diagnostics';
 const fileType=['mp4','mov','webm'].includes(extension)?'视频':['mp3','wav','m4a'].includes(extension)?'音频':['png','jpg','jpeg','webp'].includes(extension)?'图片':['srt','vtt'].includes(extension)?'字幕':extension==='json'?'数据文件':extension==='md'?'说明文档':'文件';
 const short=name.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/gi,m=>m.slice(0,8)).replace(/[a-f0-9]{32,64}/gi,m=>m.slice(0,8));
 return {category,title:`${fileType} · ${short}`};
}
export function historySize(bytes:number|string){const value=Number(bytes);return value>=1024**3?`${(value/1024**3).toFixed(2)} GB`:value>=1024**2?`${(value/1024**2).toFixed(1)} MB`:value>=1024?`${(value/1024).toFixed(1)} KB`:`${value.toLocaleString()} 字节`;}
export interface HistoryCleanupPreview {sourceId:string;deletionEnabled:false;checkedAt:string;fileLinks:number;contents:number;sharedContents:number;protectedContents:number;reviewContents:number;reviewBytes:number;recordLinks:number;sharedRecords:number;projectedRecords:number;samples:{logical_path:string;state:'shared'|'protected'|'needs-review'}[]}
