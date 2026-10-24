import{useEffect,useState}from'react';
import type{OperationsEvidence}from'../orchestration/operationsEvidence';
import{localRequest}from'./client';
interface Report{observedAt:string;automation:{stopped:boolean;lastError:string|null;lastScanAt:string|null;timezone:string;hour:number;n8nRequired:boolean};plans:{kind:string;next_due_at:string}[];jobs:{id:string;kind:string;due_at:string;status:string;attempt:number;detail:string|null}[];operations:OperationsEvidence}
const names={schedule:'调度检查',notification:'事件提醒',health:'每日健康检查',backup:'完整备份',snapshot:'部分快照'}as const;
const date=(v:string|null)=>v?new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Shanghai'}).format(new Date(v)):'暂无记录';
export function LocalSystemStatus(){
 const[open,setOpen]=useState(false),[report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
 async function refresh(){setPending(true);setError('');try{setReport(await localRequest('system-status'));}catch(e){setReport(null);setError(e instanceof Error?e.message:'状态读取失败。');}finally{setPending(false);}}
 useEffect(()=>{if(open)void refresh();},[open]);
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>系统状态</summary>{open&&<section aria-label="本地系统状态" style={{fontSize:13}}><p>本地服务负责持续调度、事件提醒和每日运维，无需 n8n。</p>{error&&<p role="alert" className="form-error">{error}</p>}{report&&<><p>{report.automation.lastError??(report.automation.stopped?'自动化已停止。':'自动化运行中。')} 每日计划：上海时间 09:00。</p><dl style={{display:'grid',gap:16}}>{(Object.keys(names)as(keyof typeof names)[]).map(kind=>{const e=report.operations[kind],plan=report.plans.find(p=>p.kind===kind);return <div key={kind}><dt>{names[kind]} · {e?e.latest.passed?'通过':'需处理':'暂无记录'}</dt><dd>{e?.latest.detail??(kind==='snapshot'?'未启用部分快照；完整备份单独记录。':'尚未执行。')}</dd>{e&&<><dd>最近结果：{date(e.latest.at)}</dd>{!e.latest.passed&&e.lastSuccess&&<dd>最近成功：{date(e.lastSuccess.at)}</dd>}{e.latest.passed&&e.lastFailure&&<dd>最近失败：{date(e.lastFailure.at)} · {e.lastFailure.detail}</dd>}</>}{plan&&<dd>下次计划：{date(plan.next_due_at)}</dd>}</div>;})}</dl><p>最近读取：{date(report.observedAt)}</p></>}<button className="button button-secondary" disabled={pending} onClick={()=>void refresh()}>{pending?'读取中…':'刷新系统状态'}</button></section>}</details>;
}
