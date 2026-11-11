import {uiText,getUiLocale} from '../i18n/ui';
import type {EpisodeMetrics} from '../episodes/episodeCatalogTypes';
import {useState} from 'react';
import {Tooltip,TooltipTrigger} from '../ui/dan-ui/components/base/tooltip/tooltip';

const yuan=(cents:number)=>new Intl.NumberFormat(getUiLocale(),{style:'currency',currency:'CNY'}).format(cents/100);
function duration(seconds:number){
 const value=Math.ceil(seconds);
 if(value<60)return `${value} 秒`;
 if(value<3600)return `${Math.floor(value/60)} 分 ${value%60} 秒`;
 return `${Math.floor(value/3600)} 时 ${Math.floor(value%3600/60)} 分`;
}
export function MetricColumnHeader({label,description}:{label:string;description:string}){
 const [open,setOpen]=useState(false);
 return <Tooltip title={description} isOpen={open} onOpenChange={setOpen} className="dan-ui dan-ui-tooltip"><TooltipTrigger className="episode-metric-heading" onPress={()=>setOpen(true)}>{label}</TooltipTrigger></Tooltip>;
}
export function EpisodeMetricsCells({metrics}:{metrics?:EpisodeMetrics}){
 const cost=metrics?.cost,seconds=metrics?.workerRunSeconds??null;
 return <>
  <div role="cell" className="episode-cost">
   {cost?.actualCents!==null&&cost?.actualCents!==undefined?<span>{uiText("实际 ")}{yuan(cost.actualCents)}</span>:null}
   {cost?.estimatedCents!==null&&cost?.estimatedCents!==undefined?<span className="episode-metric-secondary" title={cost.recalculated?uiText("按当前价格估算"):undefined}>{uiText("估算 ≈")}{yuan(cost.estimatedCents)}</span>:null}
   {cost?.unpricedCount?<small>{cost.unpricedCount}{uiText(" 次费用待确认")}</small>:null}
   {(!cost||cost.actualCents===null&&cost.estimatedCents===null&&!cost.unpricedCount)&&<span aria-label={uiText("暂无费用记录")}>—</span>}
  </div>
  <div role="cell" className="episode-stage-durations"><span>{seconds===null?uiText("未记录"):duration(seconds)}</span></div>
  <div role="cell" className="episode-generation-counts">{metrics?<><span>{uiText("图 ")}{metrics.generations.image}{uiText(" · 视频 ")}{metrics.generations.video}</span><span className="episode-metric-secondary">{uiText("口播 ")}{metrics.generations.narration}{uiText(" · 音效 ")}{metrics.generations.sound}</span>{metrics.generations.failed>0&&<small>{uiText("含 ")}{metrics.generations.failed}{uiText(" 次失败")}</small>}</>:<span aria-label={uiText("暂无生成记录")}>—</span>}</div>
 </>;
}
