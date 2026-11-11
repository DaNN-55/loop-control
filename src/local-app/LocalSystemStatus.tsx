import {uiText,getUiLocale} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {OperationsEvidence} from '../orchestration/operationsEvidence';
import {SystemStatusSurface, stateLabel, type StatusItem, type SystemState} from '../observability/SystemStatusSurface';
import {localRequest} from './client';
import {SystemStatusDrawer} from './SystemStatusDrawer';
import type {RuntimeStatus} from '../observability/runtimeStatus';
interface Report {
 observedAt:string;runtime?:RuntimeStatus|null;maintenanceAvailable?:boolean;
 automation:{stopped:boolean;lastError:string|null;lastScanAt:string|null;timezone:string;hour:number;n8nRequired:boolean;backupsEnabled?:boolean;intervalMs?:number};
 plans:{kind:string;next_due_at:string}[];
 jobs:{id:string;kind:string;due_at:string;status:string;attempt:number;detail:string|null}[];
 operations:OperationsEvidence;
}
const names={schedule:'调度检查',notification:'事件提醒',health:'每日健康检查',backup:'完整备份',snapshot:'部分快照'} as const;
const date=(v:string|null)=>v?new Intl.DateTimeFormat(getUiLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Shanghai'}).format(new Date(v)):uiText("暂无记录");
export function LocalSystemStatus({embedded=false,triggerLabel,onOpenEpisode,queueRequest=0,onQueueChange}:{embedded?:boolean;triggerLabel?:string;onOpenEpisode?:(id:string)=>boolean|void;queueRequest?:number;onQueueChange?:(queue:RuntimeStatus['queue'])=>void}){
 const [payload,setPayload]=useState<Report|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(true);
 const [open,setOpen]=useState(false),[page,setPage]=useState(1);
 const report=payload?.automation?payload:null;
 useEffect(()=>{if(queueRequest){setPage(1);setOpen(true);}},[queueRequest]);
 const queue=payload?.runtime?.queue??null;
 useEffect(()=>onQueueChange?.(queue),[queue,onQueueChange]);
 const request=useRef(0),controller=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
  if(controller.current)return;
  const current=++request.current,abort=new AbortController();controller.current=abort;
  setPending(true);setError('');
  try{const value=await localRequest('system-status'+(page>1?'?queuePage='+page:''),{signal:abort.signal});if(current===request.current)setPayload(value);}
  catch(e){if(current===request.current&&!abort.signal.aborted){setPayload(null);setError(e instanceof Error?e.message:uiText("状态读取失败。"));}}
  finally{if(current===request.current){controller.current=null;setPending(false);}}
 },[page]);
 useEffect(()=>{void refresh();return()=>{request.current++;controller.current?.abort();controller.current=null;};},[refresh]);
 useEffect(()=>{
  if(!open)return;
  void refresh();
  const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},5000);
  const visible=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',visible);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[open,refresh]);
 const automationState:SystemState=error?'offline':!report?'unknown':report.automation.stopped||report.automation.lastError?'attention':'healthy';
 const scanFrequency=report?.automation.intervalMs?uiText("每 {value0} 秒扫描",{value0:report.automation.intervalMs/1000}):uiText("每 4 秒扫描（默认）");
 const unreadText=error?uiText("不可用"):pending?uiText("读取中…"):uiText("待确认");
 const items:StatusItem[]=[{id:'automation',label:uiText("本机调度"),state:automationState,stateText:report?undefined:unreadText,detail:report?(report.automation.lastError??(report.automation.stopped?uiText("自动化已停止。"):uiText("自动化运行中。"))):error||uiText("正在读取当前状态。"),detailRows:report?[{label:uiText("扫描频率"),value:scanFrequency},{label:uiText("每日计划"),value:uiText("上海时间 {value0}:00",{value0:String(report.automation.hour??9).padStart(2,'0')})},{label:uiText("最近扫描"),value:date(report.automation.lastScanAt)}]:[]}];
 for(const kind of Object.keys(names) as (keyof typeof names)[]){
  const evidence=report?.operations[kind],disabled=kind==='backup'&&report?.automation.backupsEnabled===false,unavailable=kind==='snapshot',plan=report?.plans.find(p=>p.kind===kind);
  const rows:NonNullable<StatusItem['detailRows']>=[];
  if(evidence&&!disabled&&!unavailable){rows.push({label:uiText("最近结果"),value:date(evidence.latest.at)});if(!evidence.latest.passed&&evidence.lastSuccess)rows.push({label:uiText("最近成功"),value:date(evidence.lastSuccess.at)});if(evidence.latest.passed&&evidence.lastFailure)rows.push({label:uiText("最近失败"),value:`${date(evidence.lastFailure.at)} · ${evidence.lastFailure.detail}`});}
  rows.push({label:uiText("检查频率"),value:kind==='schedule'||kind==='notification'?scanFrequency:kind==='health'?uiText("每天 {value0}:00（上海时间）",{value0:String(report?.automation.hour??9).padStart(2,'0')}):kind==='backup'?(disabled?uiText("已关闭"):plan?uiText("每天 09:00（上海时间）"):uiText("未配置")):uiText("未启用")});
  if(plan)rows.push({label:uiText("下次计划"),value:date(plan.next_due_at)});
  const checks=kind==='health'?evidence?.latest.checks:undefined;
  const failures=checks?.filter(check=>!check.passed).length;
  items.push({id:kind,label:uiText(names[kind]),state:error?'offline':disabled||unavailable?'unknown':evidence?evidence.latest.passed?'healthy':'attention':'unknown',stateText:!report?unreadText:disabled?uiText("已关闭"):unavailable?uiText("未启用"):checks?(failures?uiText("{value0} 项异常",{value0:failures}):uiText("3 项通过")):evidence?undefined:uiText("尚未执行"),detail:!report?(error||uiText("正在读取当前状态。")):disabled?uiText("自动备份已关闭。"):unavailable?uiText("未启用部分快照。"):evidence?.latest.detail??uiText("尚未执行。"),detailRows:report?rows:[],checks,lastFailureChecks:kind==='health'&&evidence?.latest.passed?evidence.lastFailure?.checks:undefined});
 }
 const overallState:SystemState=error?'offline':items.some(i=>i.state==='attention')?'attention':automationState;
 if(!embedded)return <SystemStatusDrawer open={open} onOpen={()=>setOpen(true)} onClose={()=>setOpen(false)} runtime={payload?.runtime??null} maintenance={items} maintenanceAvailable={!!report&&payload?.maintenanceAvailable!==false} pending={pending} error={error} observedAt={payload?.observedAt??null} onRefresh={()=>void refresh()} onPage={setPage} onOpenEpisode={onOpenEpisode} triggerLabel={triggerLabel}/>;
 return <SystemStatusSurface triggerLabel={triggerLabel} embedded={embedded} items={items} overallState={overallState} summary={items.map(i=>`${i.label}：${i.stateText??stateLabel(i.state)}`).join('；')} description={uiText("查看本机调度、事件提醒与日常运维结果。")} onOpen={()=>{if(!pending)void refresh();}} footer={<><span>{uiText("页面加载、打开面板或手动刷新时读取 · 最近读取 ")}{report?date(report.observedAt):uiText("暂无")}</span><div><Button size="sm" color="secondary" className="button button-secondary" isDisabled={pending} onClick={()=>void refresh()} type="button">{pending?uiText("读取中…"):uiText("刷新系统状态")}</Button></div></>}>
  {error&&<p role="alert" className="form-error">{error}</p>}
 </SystemStatusSurface>;
}
