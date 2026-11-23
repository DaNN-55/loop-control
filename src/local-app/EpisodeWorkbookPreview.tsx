import {useState,type ReactNode} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
import type {WorkbookOrder,WorkbookPreview,WorkbookShot} from './episodeWorkbookImportTypes';
import type {assessWorkbook} from './assessEpisodeWorkbook';

type Props={
 workbook:WorkbookPreview;
 assessment:ReturnType<typeof assessWorkbook>;
 duplicateFor:(itemId:string)=>ReactNode;
 busy:boolean;
 onChange:(workbook:WorkbookPreview)=>void;
 onRemove:()=>void;
};

function PreviewRow({sheet,row,label,summary,problems,children}:{sheet:string;row:number;label:string;summary:string;problems?:string[];children:()=>ReactNode}){
 const [expanded,setExpanded]=useState(false);
 return <details className="episode-batch-preview" data-sheet={sheet} data-row={row} onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary><strong>{label}</strong><span>{summary}{problems?.[0]?' · '+uiText(problems[0]):''}</span></summary>
  {expanded&&problems&&<ul className="episode-workbook-issues">{problems.map(problem=><li className="form-error" key={problem}>{uiText(problem)}</li>)}</ul>}
  {expanded&&<div className="episode-batch-fields">{children()}</div>}
 </details>;
}

export function EpisodeWorkbookPreview({workbook,assessment,duplicateFor,busy,onChange,onRemove}:Props){
 const {issues}=assessment;
 function editOrder(row:number,field:keyof Pick<WorkbookOrder,'orderNo'|'title'|'sourceText'|'duration'>,value:string){
  onChange({...workbook,orders:workbook.orders.map(order=>order.row===row?{...order,[field]:value}:order)});
 }
 function editShot(row:number,field:keyof Omit<WorkbookShot,'row'>,value:string){
  onChange({...workbook,shots:workbook.shots.map(shot=>shot.row===row?{...shot,[field]:value}:shot)});
 }
 return <>
  <div className="episode-workbook-file"><strong>{workbook.name}</strong><Button type="button" size="sm" color="tertiary" isDisabled={busy} onPress={onRemove}>{uiText('移除文件')}</Button></div>
  <h3>{uiText('生产单')} · {workbook.orders.length}</h3>
  {workbook.orders.map(order=>{
   const label=uiText('生产单第 {value0} 行',{value0:String(order.row)}),problems=issues.orders.get(order.row),duplicate=duplicateFor(order.itemId);
   return <PreviewRow key={order.itemId} sheet="orders" row={order.row} label={label} summary={[order.orderNo,order.title,duplicate&&uiText('可能重复'),...(problems?[uiText('需要修正')]:[])].filter(Boolean).join(' · ')} problems={problems}>
    {()=> <>
     {([['orderNo','生产单编号'],['title','标题'],['sourceText','脚本正文'],['duration','目标时长（秒）']] as const).map(([field,name])=><label key={field}>{uiText(name)}
      {field==='sourceText'?<textarea name={field} aria-label={label+uiText(name)} rows={4} value={order[field]} disabled={busy} onChange={event=>editOrder(order.row,field,event.target.value)}/>:<input name={field} aria-label={label+uiText(name)} inputMode={field==='duration'?'decimal':undefined} value={order[field]} disabled={busy} onChange={event=>editOrder(order.row,field,event.target.value)}/>}
     </label>)}
     {duplicate}
    </>}
   </PreviewRow>;
  })}
  {workbook.shots.length>0&&<h3>{uiText('分镜')} · {workbook.shots.length}</h3>}
  {workbook.shots.map(shot=>{
   const label=uiText('分镜第 {value0} 行',{value0:String(shot.row)}),problems=issues.shots.get(shot.row);
   return <PreviewRow key={shot.row} sheet="shots" row={shot.row} label={label} summary={[shot.orderNo,shot.sequence&&(uiText('镜头')+' '+shot.sequence),shot.visual.split('\n')[0].slice(0,80),...(problems?[uiText('需要修正')]:[])].filter(Boolean).join(' · ')} problems={problems}>
    {()=> <>
     {([['orderNo','生产单编号'],['sequence','镜头序号'],['visual','画面描述'],['videoPrompt','视频提示词'],['narration','口播'],['caption','字幕'],['duration','镜头时长（秒）']] as const).map(([field,name])=><label key={field}>{uiText(name)}
      {(['visual','videoPrompt','narration','caption'] as string[]).includes(field)?<textarea name={field} aria-label={label+uiText(name)} rows={2} value={shot[field]} disabled={busy} onChange={event=>editShot(shot.row,field,event.target.value)}/>:<input name={field} aria-label={label+uiText(name)} inputMode={field==='sequence'?'numeric':field==='duration'?'decimal':undefined} value={shot[field]} disabled={busy} onChange={event=>editShot(shot.row,field,event.target.value)}/>}
     </label>)}
    </>}
   </PreviewRow>;
  })}
 </>;
}
