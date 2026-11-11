import {uiText,getUiLocale} from '../i18n/ui';
import {Fragment,useEffect,useRef,useState,type RefObject} from 'react';
import {ArrowLeft,CalendarClock,ChevronDown,ChevronRight,FileText,RefreshCw,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {useDialogFocus} from '../ui/useDialogFocus';
import {localRequest} from './client';
import type {RuntimeLogEntry,RuntimeLogReport} from '../observability/logTypes';
import './runtime-logs.css';

const displayDate=(value:string)=>new Intl.DateTimeFormat(getUiLocale(),{dateStyle:'short',timeStyle:'medium'}).format(new Date(value));
const sameOperation=(a:RuntimeLogEntry,b:RuntimeLogEntry)=>!!a.operationId&&a.operationId===b.operationId&&a.episodeId===b.episodeId;
export function RuntimeLogsDialog({onClose,returnFocusRef,embedded=false}:{onClose:()=>void;returnFocusRef:RefObject<HTMLElement|null>;embedded?:boolean}){
 const ref=useDialogFocus<HTMLElement>(!embedded,onClose,returnFocusRef);
 const [report,setReport]=useState<RuntimeLogReport|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(true);
 const [episode,setEpisode]=useState('all'),[range,setRange]=useState('all'),[errors,setErrors]=useState(false),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[origin,setOrigin]=useState<string|null>(null);
 const request=useRef<AbortController|null>(null),mounted=useRef(false),back=useRef<HTMLButtonElement>(null),focusRecord=useRef<string|null>(null);
 async function refresh(){
  if(request.current)return;const controller=new AbortController();request.current=controller;setPending(true);setError('');
  try{const value:RuntimeLogReport=await localRequest('logs',{signal:controller.signal});if(mounted.current){setReport(value);setSelected(current=>value.entries.some(e=>e.id===current)?current:null);setOrigin(current=>value.entries.some(e=>e.id===current)?current:null);}}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:uiText("日志读取失败，请重试。"));}
  finally{if(request.current===controller){request.current=null;if(mounted.current)setPending(false);}}
 }
 useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;request.current?.abort();request.current=null;};},[]);
 useEffect(()=>{if(origin)back.current?.focus();else if(focusRecord.current){ref.current?.querySelector<HTMLButtonElement>(`[data-runtime-log="${focusRecord.current}"]`)?.focus();focusRecord.current=null;}},[origin]);
 const entries=report?.entries??[],anchor=entries.find(e=>e.id===origin),invalid=range==='custom'&&!!start&&!!end&&Date.parse(start)>Date.parse(end);
 const now=report?Date.parse(report.observedAt):Date.now(),from=range==='day'?now-86400000:range==='week'?now-7*86400000:range==='custom'&&start?Date.parse(start):-Infinity,to=range==='custom'&&end?Date.parse(end)+59999:Infinity;
 const filtered=entries.filter(e=>anchor?sameOperation(anchor,e):!invalid&&(episode==='all'||(episode==='unknown'?!e.episodeId:e.episodeId===episode))&&(!errors||e.level==='ERROR')&&(range==='all'||(range==='unknown'?!e.occurredAt:!!e.occurredAt&&Date.parse(e.occurredAt)>=from&&Date.parse(e.occurredAt)<=to)));
 const choices=[...new Map(entries.filter(e=>e.episodeId).map(e=>[e.episodeId!,{value:e.episodeId!,label:`${e.episodeName??uiText("名称未记录")} · ${e.episodeId}`}])).values()];
 function resetSelection(){setSelected(null);}
 function leaveContext(){focusRecord.current=origin;setSelected(origin);setOrigin(null);}
 const content=<section ref={embedded?undefined:ref} role={embedded?undefined:"dialog"} aria-modal={embedded?undefined:true} aria-labelledby={embedded?undefined:"runtime-logs-title"} className={`modal-card runtime-logs-dialog${embedded?" owner-settings-pane":""}`}>
  <header><h2 id="runtime-logs-title">{uiText("日志")}</h2><div><Button size="sm" color="secondary" iconLeading={RefreshCw} isDisabled={pending} onPress={()=>void refresh()}>{pending?uiText("读取中…"):uiText("刷新")}</Button><Button size="sm" color="tertiary" iconLeading={X} aria-label={uiText("关闭日志")} data-dialog-initial-focus onPress={onClose}/></div></header>
  <div className="runtime-logs-body">
   <fieldset className="rl-filters" disabled={!!anchor} aria-label={uiText("日志筛选")}>
    <div className="rl-filter"><NativeSelect size="sm" aria-label={uiText("生产单")} icon={FileText} value={episode} onChange={e=>{setEpisode(e.target.value);resetSelection();}} options={[{value:'all',label:uiText("全部生产单")},...choices,...(entries.some(e=>!e.episodeId)?[{value:'unknown',label:uiText("生产单未记录")}]:[])]}/></div>
    <div className="rl-filter"><NativeSelect size="sm" aria-label={uiText("时间范围")} icon={CalendarClock} value={range} onChange={e=>{setRange(e.target.value);resetSelection();}} options={[{value:'all',label:uiText("全部已读取时间")},{value:'day',label:uiText("最近 24 小时")},{value:'week',label:uiText("最近 7 天")},{value:'custom',label:uiText("自定义时间")},{value:'unknown',label:uiText("发生日期未记录")}]}/></div>
    <label className="rl-errors"><input type="checkbox" checked={errors} onChange={e=>{setErrors(e.target.checked);resetSelection();}}/>{uiText("只看错误")}</label>
    {range==='custom'&&<div className="rl-custom"><label>{uiText("开始时间")}<input type="datetime-local" aria-label={uiText("开始时间")} value={start} onChange={e=>{setStart(e.target.value);resetSelection();}}/></label><label>{uiText("结束时间")}<input type="datetime-local" aria-label={uiText("结束时间")} aria-invalid={invalid} aria-describedby="rl-range-error" value={end} onChange={e=>{setEnd(e.target.value);resetSelection();}}/></label></div>}
   </fieldset>
   {invalid&&!anchor&&<p className="form-error" id="rl-range-error" role="alert">{uiText("结束时间应晚于或等于开始时间。")}</p>}
   {error&&<p className="form-error" role="alert">{error}{report?uiText(" 当前保留上次读取的结果。"):''}</p>}
   {anchor&&<div className="rl-context"><div><strong>{uiText("同次操作 · ")}{anchor.operationId}</strong><span>{uiText("包含已读取的普通记录和错误，暂不应用上方筛选。")}</span></div><Button size="sm" color="secondary" ref={back} iconLeading={ArrowLeft} onPress={leaveContext}>{uiText("返回筛选结果")}</Button></div>}
   <div className="rl-result" role="status">{pending&&!report?uiText("正在读取日志…"):uiText("显示 {value0} 条记录{value1}",{value0:filtered.length,value1:anchor?uiText(' · 同次操作'):''})}{report?.truncated?uiText(" · 当前为最近 {value0} 条以内的摘录",{value0:report.maxEntries}):''}</div>
   {!anchor&&!errors&&entries.length>0&&entries.every(entry=>entry.level==='ERROR')&&<p className="rl-note">{uiText('当前摘录只有错误记录；没有普通日志不代表没有成功操作。')}</p>}
   {!anchor&&range!=='all'&&range!=='unknown'&&entries.some(e=>!e.occurredAt)&&<p className="rl-note">{uiText("未记录发生日期的日志未参与此时间筛选。")}</p>}
   <div className="rl-table-surface"><table aria-label={uiText("后端日志")}><colgroup><col className="rl-col-time"/><col className="rl-col-level"/><col className="rl-col-name"/><col className="rl-col-id"/><col className="rl-col-source"/><col/></colgroup><thead><tr>{[uiText("时间"),uiText("级别"),uiText("生产单名称"),uiText("生产单编号"),uiText("处理位置"),uiText("内容")].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
    {filtered.map(log=>{const open=selected===log.id,count=entries.filter(e=>sameOperation(log,e)).length;return <Fragment key={log.id}>
     <tr className={`rl-row ${open?'is-open':''} ${log.level==='ERROR'?'is-error':''}`}><td className="rl-time">{log.occurredAt?displayDate(log.occurredAt):log.time?uiText("{value0}（日期未记录）",{value0:log.time}):uiText("未记录")}</td><td className="rl-level">{{INFO:uiText("记录"),WARN:uiText("提醒"),ERROR:uiText("错误")}[log.level]}</td><td className="rl-name">{log.episodeName??uiText("未记录")}</td><td className="rl-id">{log.episodeId??uiText("未记录")}</td><td className="rl-source">{uiText(log.source)}</td><td className="rl-message"><button type="button" data-runtime-log={log.id} aria-expanded={open} aria-controls={`rl-detail-${log.id}`} onClick={()=>setSelected(open?null:log.id)}>{open?<ChevronDown aria-hidden="true"/>:<ChevronRight aria-hidden="true"/>}<span>{uiText(log.explanation.what)}</span></button></td></tr>
     {open&&<tr className="rl-detail" id={`rl-detail-${log.id}`}><td colSpan={6}><div className="rl-detail-grid"><section aria-label={uiText("日志说明")}><h3>{uiText("日志说明")}</h3><dl><dt>{uiText("发生了什么")}</dt><dd>{uiText(log.explanation.what)}</dd><dt>{uiText("当前结果")}</dt><dd>{uiText(log.explanation.result)}</dd>{log.explanation.reason&&<><dt>{uiText("原因")}</dt><dd>{uiText(log.explanation.reason)}</dd></>}{log.explanation.suggestion&&<><dt>{uiText("处理建议")}</dt><dd>{uiText(log.explanation.suggestion)}</dd></>}<dt>{uiText("所属操作")}</dt><dd>{log.operationId??uiText("未记录")}</dd><dt>{uiText("请求编号")}</dt><dd>{log.requestId??uiText("未记录")}</dd><dt>{uiText("来源文件")}</dt><dd>{log.sourceFile}{log.line?uiText(" · 第 {value0} 行",{value0:log.line}):uiText(" · 文件尾部摘录")}</dd></dl>{!anchor&&log.operationId?<Button size="sm" color="secondary" onPress={()=>setOrigin(log.id)}>{uiText("查看同次操作的前后日志（")}{count} {uiText("条）")}</Button>:!log.operationId?<p className="rl-note">{uiText("未记录操作编号，无法关联同次操作。")}</p>:null}</section><section aria-label={uiText("原始日志（已脱敏）")}><h3>{uiText("原始日志（已脱敏）")}</h3><pre>{log.raw}</pre></section></div></td></tr>}
    </Fragment>;})}
    {!pending&&!filtered.length&&<tr><td colSpan={6} className="rl-empty">{error&&!report?uiText("日志读取失败，请点击刷新重试。"):invalid?uiText("请先调整时间范围。"):report&&!report.sourceAvailable?uiText("日志文件尚未生成。"):entries.length?uiText("没有符合条件的日志，请调整筛选。"):uiText("暂未读取到可识别的日志。")}</td></tr>}
   </tbody></table></div>
   <footer className="rl-note">{uiText("打开或刷新时读取 · ")}{report?uiText("最近读取 {value0}",{value0:displayDate(report.observedAt)}):uiText("尚未读取")}{uiText("。缺失信息保持未知；日志不代表当前服务状态。")}</footer>
  </div>
 </section>;
 return embedded?content:<div className="modal-backdrop runtime-logs-backdrop">{content}</div>;
}
