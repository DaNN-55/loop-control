// Throwaway preview of the approved log layout in the current project visual system.
// One established direction; no layout variants or live business operations.
import {Fragment,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft,CalendarClock,ChevronDown,ChevronRight,FileText,Moon,Sun} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {LoopControlMark} from './LoopControlMark';
import {logs,names,levelNames,descriptions,operationNames,retention,type MockLog} from './logs.prototype.data';
import {historySnapshot} from './logs.prototype.history';
import '../styles.css';
import '../ui/impeccable/foundation.css';
import '../ui/impeccable/surface-polish.css';
import './logs.prototype.css';

type Filters={episode:string;range:string;start:string;end:string;errors:boolean};
const initial:Filters={episode:'all',range:'all',start:'',end:'',errors:false};
const millis=(time:string)=>{const [h,m,s='0']=time.split(':');return Math.round((Number(h)*3600+Number(m)*60+Number(s))*1000);};
const sameOperation=(origin:MockLog,log:MockLog)=>origin.episode===log.episode&&origin.operationId===log.operationId;

function Prototype(){
 const [source,setSource]=useState<'history'|'mock'>(new URLSearchParams(location.search).get('source')==='mock'?'mock':'history');
 const [historyOpen,setHistoryOpen]=useState(true);
 const [theme,setTheme]=useState<'light'|'dark'>('light');
 const [filters,setFilters]=useState<Filters>(initial);
 const [selected,setSelected]=useState<number|null>(null);
 const [origin,setOrigin]=useState<number|null>(null);
 const [showPolicy,setShowPolicy]=useState(false);
 const recordButtons=useRef(new Map<number,HTMLButtonElement>());
 const backButton=useRef<HTMLButtonElement>(null);
 const restoreFocus=useRef<number|null>(null);
 useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 useEffect(()=>{
  if(origin!==null)backButton.current?.focus();
  else if(restoreFocus.current!==null){recordButtons.current.get(restoreFocus.current)?.focus();restoreFocus.current=null;}
 },[origin]);
 const invalid=filters.range==='custom'&&!!filters.start&&!!filters.end&&millis(filters.start)>millis(filters.end);
 const expired=origin===null&&filters.range==='expired';
 let start=0,end=86_399_999;
 if(filters.range==='minute20'){start=millis('10:20:00');end=millis('10:20:59')+999;}
 if(filters.range==='minute21'){start=millis('10:21:00');end=millis('10:21:59')+999;}
 if(filters.range==='custom'){if(filters.start)start=millis(filters.start);if(filters.end)end=millis(filters.end)+999;}
 const visible=logs.map((log,index)=>({log,index})).filter(({log})=>origin!==null?sameOperation(logs[origin],log):!expired&&!invalid&&(filters.episode==='all'||filters.episode===log.episode)&&(!filters.errors||log.level==='ERROR')&&millis(log.time)>=start&&millis(log.time)<=end).sort((a,b)=>millis(a.log.time)-millis(b.log.time));
 function filter<K extends keyof Filters>(key:K,value:Filters[K]){setFilters(current=>({...current,[key]:value}));setSelected(null);}
 function returnToResults(){restoreFocus.current=origin;setSelected(origin);setOrigin(null);}
 function changeSource(value:'history'|'mock'){setSource(value);setOrigin(null);setSelected(null);setHistoryOpen(true);const url=new URL(location.href);url.searchParams.set('source',value);history.replaceState(null,'',url);}

 return <div className="logs-prototype dan-ui product-ui" data-theme={theme}>
  <header className="lp-topbar"><div className="lp-brand"><LoopControlMark size={24}/><span>Loop Control</span><span className="lp-divider"/><span className="lp-muted">日志预览</span></div><div className="lp-top-actions"><span className="lp-preview-label">隔离预览 · {source==='history'?'真实日志副本':'模拟数据'}</span><Button size="sm" color="tertiary" aria-label={theme==='light'?'切换深色':'切换浅色'} iconLeading={theme==='light'?Moon:Sun} onPress={()=>setTheme(theme==='light'?'dark':'light')}/></div></header>
  <main className="lp-main">
   <header className="lp-page-header"><h1>日志</h1><span className="lp-muted">{source==='history'?`导入于 ${historySnapshot.importedOn}`:retention.asOf}</span></header>
   <div className="lp-source-picker"><NativeSelect id="lp-data-source" aria-label="数据来源" size="sm" icon={FileText} value={source} onChange={e=>changeSource(e.target.value as 'history'|'mock')} options={[{value:'history',label:'真实历史日志 · 1 条'},{value:'mock',label:'模拟日志 · 11 条'}]}/></div>
   <fieldset className="lp-filters" hidden={source==='history'} disabled={origin!==null} aria-label="日志筛选">
    <div className="lp-filter"><NativeSelect id="lp-episode" aria-label="生产单" size="sm" icon={FileText} value={filters.episode} onChange={e=>filter('episode',e.target.value)} options={[{value:'all',label:'全部生产单'},...Object.entries(names).map(([value,name])=>({value,label:`${name} · ${value}`}))]}/></div>
    <div className="lp-filter"><NativeSelect id="lp-range" aria-label="时间范围" size="sm" icon={CalendarClock} value={filters.range} onChange={e=>filter('range',e.target.value)} options={[{value:'all',label:'全部保留日志'},{value:'minute20',label:'10:20:00 – 10:20:59'},{value:'minute21',label:'10:21:00 – 10:21:59'},{value:'custom',label:'自定义时间'},{value:'expired',label:`${retention.expiredDate} · 已过期示例`}]}/></div>
    <label className="lp-errors"><input id="lp-errors" type="checkbox" checked={filters.errors} onChange={e=>filter('errors',e.target.checked)}/>只看错误</label>
    {filters.range==='custom'&&<div className="lp-custom"><label>开始时间<input id="lp-start" aria-describedby="lp-range-error" type="time" step="1" value={filters.start} onChange={e=>filter('start',e.target.value)}/></label><span aria-hidden="true">—</span><label>结束时间<input id="lp-end" aria-describedby="lp-range-error" aria-invalid={invalid} type="time" step="1" value={filters.end} onChange={e=>filter('end',e.target.value)}/></label></div>}
   </fieldset>
   <p id="lp-range-error" role={source==='mock'&&invalid?'alert':undefined} className="lp-error" hidden={source==='history'||!invalid}>结束时间应晚于或等于开始时间。</p>
   {source==='mock'&&origin!==null&&<div className="lp-context"><div><strong>同次操作全部日志 · {operationNames[logs[origin].operationId]} · {names[logs[origin].episode]}</strong><span>操作编号 {logs[origin].operationId} · 包含入口和后台记录，上方筛选暂不应用。</span></div><Button ref={backButton} size="sm" color="secondary" iconLeading={ArrowLeft} onPress={returnToResults}>返回筛选结果</Button></div>}
   <div className="lp-result-bar"><div className="lp-results" role="status">{source==='history'?'显示 1 条真实历史日志 · 脱敏摘录':invalid?'请调整时间范围':expired?'所选时间的日志已过期':origin!==null?`本次操作共 ${visible.length} 条记录`:`显示 ${visible.length} 条记录`}</div>{source==='mock'&&<button type="button" className="lp-policy-toggle" aria-expanded={showPolicy} aria-controls="lp-policy" onClick={()=>setShowPolicy(!showPolicy)}>保留 {retention.days} 天 · 上限 {retention.capacityGB} GB（示例）{showPolicy?<ChevronDown aria-hidden="true"/>:<ChevronRight aria-hidden="true"/>}</button>}</div>
   {source==='mock'&&showPolicy&&<section className="lp-policy" id="lp-policy" aria-label="日志保留规则"><p>记录关键步骤的开始、结果与异常，普通、提醒和错误日志一起保存；默认不记录反复轮询和逐函数调试信息。</p><p>本例可查询 {retention.earliestDate} 起的日志。到期或达到容量上限后，优先按完整的已结束操作清理较早记录，保留排查上下文。</p><p>日志清理不删除生产单、脚本、成片、执行快照或任务回执。这是模拟规则，当前页面不执行自动清理。</p></section>}
   <div className="lp-log-surface"><table aria-label="后端日志"><colgroup><col className="lp-col-time"/><col className="lp-col-level"/><col className="lp-col-name"/><col className="lp-col-id"/><col className="lp-col-source"/><col/></colgroup><thead><tr>{['时间','级别','生产单名称','生产单编号','处理位置','内容'].map(title=><th scope="col" key={title}>{title}</th>)}</tr></thead><tbody>
    {source==='history'&&<>
     <tr className={`lp-row is-error ${historyOpen?'is-open':''}`} data-history-record><td className="lp-time">未记录</td><td className="lp-level">错误</td><td className="lp-name">未记录</td><td className="lp-id">未记录</td><td className="lp-source">数据库连接</td><td className="lp-message"><button type="button" data-history-log aria-expanded={historyOpen} aria-controls="lp-history-detail" onClick={()=>setHistoryOpen(!historyOpen)}>{historyOpen?<ChevronDown aria-hidden="true"/>:<ChevronRight aria-hidden="true"/>}<span>数据库连接意外中断</span></button></td></tr>
     {historyOpen&&<tr className="lp-detail" id="lp-history-detail"><td colSpan={6}><div className="lp-detail-grid"><section aria-label="日志说明"><h2>日志说明</h2><dl>
      <dt>发生了什么</dt><dd>PostgreSQL 数据库连接意外中断。</dd>
      <dt>已知影响</dt><dd>这条连接已断开；日志未说明哪些请求或生产单受到影响。</dd>
      <dt>原因</dt><dd>日志未记录具体中断原因。</dd>
      <dt>处理建议</dt><dd>若再次出现，检查本机数据库服务与连接情况，并核对原操作结果。</dd>
      <dt>发生时间</dt><dd>未记录；导入日期不代表发生日期。</dd>
      <dt>操作编号</dt><dd>未记录，无法关联同次操作。</dd>
      <dt>来源文件</dt><dd>{historySnapshot.sourceFile}</dd>
      <dt>原文位置</dt><dd>第 {historySnapshot.sourceStartLine}–{historySnapshot.sourceEndLine} 行</dd>
     </dl></section><section aria-label="原始日志（脱敏摘录）"><h2>原始日志（脱敏摘录）</h2><p className="lp-redaction-note">项目绝对路径替换为「[项目目录]」，保留原始错误和调用位置。</p><pre>{historySnapshot.rawExcerpt}</pre></section></div></td></tr>}
    </>}
    {source==='mock'&&visible.map(({log,index})=>{
     const description=descriptions[index],open=selected===index;
     const fields:([string,string|number|boolean|undefined])[]=log.level==='ERROR'?[['原因',description.reason],['影响',description.impact],['处理办法',description.action]]:[['发生了什么',description.message],['当前结果',description.result]];
     fields.push(['所属操作',`${operationNames[log.operationId]} · ${log.operationId}`],['请求编号',log.data.requestId]);
     if(log.data.taskId)fields.push(['后台任务',log.data.taskId]);
     if(log.data.attempt)fields.push(['执行尝试',`第 ${log.data.attempt} 次`]);
     if(log.data.sourcePath)fields.push(['涉及文件',log.data.sourcePath]);
     if(typeof log.data.fileSize==='number')fields.push(['文件大小',`${log.data.fileSize} 字节`]);
     if(typeof log.data.scriptCharacters==='number')fields.push(['脚本正文',`${log.data.scriptCharacters} 字；未记录正文`]);
     fields.push(['处理位置',description.location]);
     const count=logs.filter(item=>sameOperation(log,item)).length;
     const record={time:log.time,level:log.level,episodeId:log.episode,operationId:log.operationId,source:log.source,message:log.message,...log.data};
     return <Fragment key={index}>
      <tr className={`lp-row ${open?'is-open':''} ${log.level==='ERROR'?'is-error':''}`} data-record={index}>
       <td className="lp-time">{log.time}</td><td className="lp-level">{levelNames[log.level]}</td><td className="lp-name">{names[log.episode]}</td><td className="lp-id">{log.episode}</td><td className="lp-source">{description.location}</td><td className="lp-message"><button type="button" ref={element=>{if(element)recordButtons.current.set(index,element);else recordButtons.current.delete(index);}} data-log={index} aria-expanded={open} aria-controls={`lp-detail-${index}`} onClick={()=>setSelected(open?null:index)}>{open?<ChevronDown aria-hidden="true"/>:<ChevronRight aria-hidden="true"/>}<span>{description.message}</span></button></td>
      </tr>
      {open&&<tr className="lp-detail" id={`lp-detail-${index}`}><td colSpan={6}><div className="lp-detail-grid"><section aria-label="日志说明"><h2>日志说明</h2><dl>{fields.filter(([,value])=>value!==undefined).map(([label,value])=><Fragment key={label}><dt>{label}</dt><dd className={label==='原因'?'lp-error':undefined}>{String(value)}</dd></Fragment>)}</dl>{origin===null&&<Button size="sm" color="secondary" data-context={index} onPress={()=>setOrigin(index)}>查看同次操作的前后日志（{count} 条）</Button>}</section><section aria-label="原始日志（已脱敏）"><h2>原始日志（已脱敏）</h2><p className="lp-redaction-note">凭据和正文未记录，文件路径使用相对路径。</p><pre>{JSON.stringify(record,null,2)}</pre></section></div></td></tr>}
     </Fragment>;
    })}
    {source==='mock'&&visible.length===0&&<tr><td colSpan={6} className="lp-empty">{expired?<><strong>{retention.expiredDate} 的日志已过期</strong><p>本例仅保留 {retention.earliestDate} 起的日志，无法通过日志判断当天是否执行或出错。</p><p>生产单和材料不受日志清理影响。请选择其他时间查看。</p></>:invalid?'请先调整时间范围。':'没有符合条件的日志，请调整筛选。'}</td></tr>}
   </tbody></table></div>
   <p className="lp-note">{source==='history'?'本条为已有日志的静态副本，不反映当前服务状态；未记录的信息保持未知。':'「记录」表示一条信息，不代表任务已经完成；是否完成，以日志中的具体结果为准。'}</p>
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Prototype/>);
