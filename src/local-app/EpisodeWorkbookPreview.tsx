import {useState,type ReactNode} from 'react';
import {Trash2} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
import type {WorkbookOrder,WorkbookPreview,WorkbookShot} from './episodeWorkbookImportTypes';
import type {assessWorkbook} from './assessEpisodeWorkbook';

type Props={
 workbook:WorkbookPreview;
 assessment:ReturnType<typeof assessWorkbook>;
 duplicateFor:(itemId:string)=>ReactNode;
 seriesFor:(itemId:string)=>ReactNode;
 seriesTag:(itemId:string)=>ReactNode;
 seriesSummary:(itemId:string)=>string;
 busy:boolean;
 onChange:(workbook:WorkbookPreview)=>void;
 onRemove:()=>void;
};

function PreviewRow({sheet,row,label,tag,summary,problems,children}:{sheet:string;row:number;label:string;tag?:ReactNode;summary:string;problems?:string[];children:()=>ReactNode}){
 const [expanded,setExpanded]=useState(false);
 return <details className="episode-batch-preview" data-sheet={sheet} data-row={row} onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary>
   <span className="episode-batch-preview-title"><strong>{label}</strong>{tag}</span>
   {(summary||problems)&&<small>{[summary,problems?.[0]&&uiText(problems[0])].filter(Boolean).join(' · ')}</small>}
  </summary>
  {expanded&&problems&&problems.length>1&&<ul className="episode-workbook-issues">{problems.slice(1).map(problem=><li className="form-error" key={problem}>{uiText(problem)}</li>)}</ul>}
  {expanded&&<div className="episode-batch-fields">{children()}</div>}
 </details>;
}

export function EpisodeWorkbookPreview({workbook,assessment,duplicateFor,seriesFor,seriesTag,seriesSummary,busy,onChange,onRemove}:Props){
 const {issues,shotsByOrder,unmatchedShots}=assessment;
 function editOrder(row:number,field:keyof Pick<WorkbookOrder,'orderNo'|'title'|'sourceText'|'duration'>,value:string){
  onChange({...workbook,orders:workbook.orders.map(order=>order.row===row?{...order,[field]:value}:order)});
 }
 function editShot(row:number,field:keyof Omit<WorkbookShot,'row'>,value:string){
  onChange({...workbook,shots:workbook.shots.map(shot=>shot.row===row?{...shot,[field]:value}:shot)});
 }
 function shotPreview(shot:WorkbookShot,unmatched=false){
  const sequence=Number(shot.sequence);
  const label=/^\d+$/.test(shot.sequence.trim())&&Number.isSafeInteger(sequence)&&sequence>0
   ?uiText('镜头 {value0}',{value0:String(sequence)}):uiText('镜头');
  const summary=[unmatched&&shot.orderNo,shot.visual.split('\n')[0].trim().slice(0,80)].filter(Boolean).join(' · ');
  return <PreviewRow key={shot.row} sheet="shots" row={shot.row} label={label} summary={summary} problems={issues.shots.get(shot.row)}>
   {()=> <>
    <label>{uiText('生产单编号')}<input name="orderNo" aria-label={label+' '+uiText('生产单编号')} defaultValue={shot.orderNo} disabled={busy}
     onBlur={event=>{if(event.target.value!==shot.orderNo)editShot(shot.row,'orderNo',event.target.value);}}
     onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.blur();}}}/></label>
    {([['sequence','镜头序号'],['visual','画面描述'],['videoPrompt','视频提示词'],['narration','口播'],['caption','字幕'],['duration','镜头时长（秒）']] as const).map(([field,name])=><label key={field}>{uiText(name)}
     {field==='sequence'||field==='duration'?<input name={field} aria-label={label+' '+uiText(name)} inputMode={field==='sequence'?'numeric':'decimal'} value={shot[field]} disabled={busy} onChange={event=>editShot(shot.row,field,event.target.value)}/>:<textarea name={field} aria-label={label+' '+uiText(name)} rows={2} value={shot[field]} disabled={busy} onChange={event=>editShot(shot.row,field,event.target.value)}/>}
    </label>)}
   </>}
  </PreviewRow>;
 }
 return <>
  <div className="episode-workbook-file"><strong>{workbook.name}</strong><Button type="button" size="sm" color="tertiary-destructive" iconLeading={Trash2} aria-label={uiText('移除文件')} title={uiText('移除文件')} isDisabled={busy} onPress={onRemove}/></div>
  {workbook.orders.map(order=>{
   const label=order.title.trim()||uiText('生产单第 {value0} 行',{value0:String(order.row)});
   const duplicate=duplicateFor(order.itemId),shots=shotsByOrder.get(order.orderNo.trim())??[];
   const summary=[order.orderNo,seriesSummary(order.itemId),shots.length>0&&uiText('{value0} 个镜头',{value0:String(shots.length)}),duplicate&&uiText('可能重复')].filter(Boolean).join(' · ');
   return <PreviewRow key={order.itemId} sheet="orders" row={order.row} label={label} tag={seriesTag(order.itemId)} summary={summary} problems={issues.orders.get(order.row)}>
    {()=> <>
     {seriesFor(order.itemId)}
     {shots.length>0&&<div className="episode-workbook-shots">{shots.map(shot=>shotPreview(shot))}</div>}
     {([['orderNo','生产单编号'],['title','标题'],['sourceText','脚本正文'],['duration','目标时长（秒）']] as const).map(([field,name])=><label key={field}>{uiText(name)}
      {field==='sourceText'?<textarea name={field} aria-label={label+' '+uiText(name)} rows={4} value={order[field]} disabled={busy} onChange={event=>editOrder(order.row,field,event.target.value)}/>:<input name={field} aria-label={label+' '+uiText(name)} inputMode={field==='duration'?'decimal':undefined} value={order[field]} disabled={busy} onChange={event=>editOrder(order.row,field,event.target.value)}/>}
     </label>)}
     {duplicate}
    </>}
   </PreviewRow>;
  })}
  {unmatchedShots.length>0&&<section className="episode-workbook-unmatched">
   <h3>{uiText('待关联的分镜')}</h3>
   <div className="episode-workbook-shots">{unmatchedShots.map(shot=>shotPreview(shot,true))}</div>
  </section>}
 </>;
}
