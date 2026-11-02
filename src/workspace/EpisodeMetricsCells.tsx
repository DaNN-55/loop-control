import {useEffect,useState} from 'react';
import type {EpisodeMetrics,ProductionStep} from '../episodes/episodeCatalogTypes';
import {Tooltip,TooltipTrigger} from '../ui/dan-ui/components/base/tooltip/tooltip';

const stepLabels:Record<ProductionStep,string>={script:'脚本',preparation:'素材',editing:'剪辑',delivery:'交付'};
const yuan=(cents:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(cents/100);
function duration(seconds:number){
 const value=Math.ceil(seconds);
 if(value<60)return `${value} 秒`;
 if(value<3600)return `${Math.floor(value/60)} 分 ${value%60} 秒`;
 return `${Math.floor(value/3600)} 时 ${Math.floor(value%3600/60)} 分`;
}
export function MetricColumnHeader({label,description}:{label:string;description:string}){
 return <Tooltip title={description} className="dan-ui dan-ui-tooltip"><TooltipTrigger className="episode-metric-heading" aria-label={`${label}：${description}`}>{label}</TooltipTrigger></Tooltip>;
}
export function EpisodeMetricsCells({metrics,step='script'}:{metrics?:EpisodeMetrics;step?:ProductionStep}){
 const cost=metrics?.cost,startedAt=metrics?.stageStartedAt[step];
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{if(!startedAt||metrics?.finishedAt)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[startedAt,metrics?.finishedAt]);
 const seconds=startedAt?Math.max(0,((metrics?.finishedAt?Date.parse(metrics.finishedAt):now)-Date.parse(startedAt))/1000):null;
 return <>
  <div role="cell" className="episode-cost">
   {cost?.actualCents!==null&&cost?.actualCents!==undefined?<span>实际 {yuan(cost.actualCents)}</span>:null}
   {cost?.estimatedCents!==null&&cost?.estimatedCents!==undefined?<span className="episode-metric-secondary" title={cost.recalculated?'按当前价格估算':undefined}>估算 ≈{yuan(cost.estimatedCents)}</span>:null}
   {cost?.unpricedCount?<small>{cost.unpricedCount} 次费用待确认</small>:null}
   {(!cost||cost.actualCents===null&&cost.estimatedCents===null&&!cost.unpricedCount)&&<span aria-label="暂无费用记录">—</span>}
  </div>
  <div role="cell" className="episode-stage-durations"><span>{stepLabels[step]} · {seconds===null?'未记录':duration(seconds)}</span></div>
  <div role="cell" className="episode-generation-counts">{metrics?<><span>图 {metrics.generations.image} · 视频 {metrics.generations.video}</span><span className="episode-metric-secondary">口播 {metrics.generations.narration} · 音效 {metrics.generations.sound}</span>{metrics.generations.failed>0&&<small>含 {metrics.generations.failed} 次失败</small>}</>:<span aria-label="暂无生成记录">—</span>}</div>
 </>;
}
