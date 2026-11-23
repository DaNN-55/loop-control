import {type ReactNode} from 'react';
import {Trash2} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
import {EpisodeImportPreviewRow,type EpisodeImportEditSession} from './EpisodeImportPreviewRow';
import type {WorkbookPreview,WorkbookShot} from './episodeWorkbookImportTypes';
import type {assessWorkbook} from './assessEpisodeWorkbook';

type Props={
 workbook:WorkbookPreview;
 assessment:ReturnType<typeof assessWorkbook>;
 duplicateFor:(itemId:string)=>ReactNode;
 seriesFor:(itemId:string,value:string,onChange:(value:string)=>void)=>ReactNode;
 seriesValue:(itemId:string)=>string;
 seriesTag:(itemId:string)=>ReactNode;
 seriesSummary:(itemId:string)=>string;
 onSeriesSave:(itemId:string,value:string)=>void;
 editSession:EpisodeImportEditSession;
 busy:boolean;
 onChange:(workbook:WorkbookPreview)=>void;
 onRemove:()=>void;
};

const orderFields=[['orderNo','生产单编号'],['title','标题'],['duration','目标时长（秒）']] as const;
const shotCopyFields=[['videoPrompt','视频提示词'],['narration','口播'],['caption','字幕']] as const;
const shotKey=(row:number)=>'shot:'+row;
const seconds=(value:string)=>value.trim()?uiText('{value0} 秒',{value0:value.trim()}):'';

function problemsText(problems:string[]|undefined){
 return problems?.map(problem=>uiText(problem)).join(' · ');
}

export function EpisodeWorkbookPreview({
 workbook,assessment,duplicateFor,seriesFor,seriesValue,seriesTag,seriesSummary,onSeriesSave,editSession,busy,onChange,onRemove,
}:Props){
 const {issues,shotsByOrder,unmatchedShots}=assessment;

 function shotPreview(shot:WorkbookShot,unmatched=false){
  const sequence=Number(shot.sequence);
  const label=/^\d+$/.test(shot.sequence.trim())&&Number.isSafeInteger(sequence)&&sequence>0
   ?uiText('镜头 {value0}',{value0:String(sequence)}):uiText('镜头');
  const firstLine=shot.visual.split('\n')[0].trim();
  const title=firstLine.slice(0,80);
  const summary=[unmatched&&shot.orderNo,problemsText(issues.shots.get(shot.row))].filter(Boolean).join(' · ');
  return <EpisodeImportPreviewRow key={shot.row} id={shotKey(shot.row)} name={title||label} editLabel={label} leading={title?label:undefined}
   trailing={seconds(shot.duration)} summary={summary} sheet="shots" row={shot.row} initial={shot} editSession={editSession} busy={busy}
   preview={<>
    {shot.visual.trim()!==title&&<p className="episode-import-read-text">{shot.visual}</p>}
    <dl className="episode-import-shot-copy">
     {shotCopyFields.map(([field,name])=>shot[field].trim()&&<div key={field}><dt>{uiText(name)}</dt><dd>{shot[field]}</dd></div>)}
    </dl>
   </>}
   fields={(draft,setDraft)=><>
    <div className="episode-import-shot-fields">
     <label>{uiText('镜头序号')}<input name="sequence" inputMode="numeric" value={draft.sequence} onChange={event=>setDraft({...draft,sequence:event.target.value})}/></label>
     <label>{uiText('画面描述')}<textarea name="visual" rows={1} value={draft.visual} onChange={event=>setDraft({...draft,visual:event.target.value})}/></label>
     <label>{uiText('镜头时长（秒）')}<input name="duration" inputMode="decimal" value={draft.duration} onChange={event=>setDraft({...draft,duration:event.target.value})}/></label>
    </div>
    <div className="episode-import-shot-copy">
     {shotCopyFields.map(([field,name])=><label key={field}>{uiText(name)}<textarea name={field} rows={2} value={draft[field]} onChange={event=>setDraft({...draft,[field]:event.target.value})}/></label>)}
    </div>
    <label className="episode-import-shot-link">{uiText('生产单编号')}<input name="orderNo" value={draft.orderNo} onChange={event=>setDraft({...draft,orderNo:event.target.value})}/></label>
   </>}
   onSave={draft=>onChange({...workbook,shots:workbook.shots.map(current=>current.row===draft.row?draft:current)})}/>;
 }

 return <>
  <div className="episode-workbook-file"><strong>{workbook.name}</strong><Button type="button" size="sm" color="tertiary-destructive" iconLeading={Trash2} aria-label={uiText('移除文件')} title={uiText('移除文件')} isDisabled={busy||editSession.active!==null} onPress={onRemove}/></div>
  {workbook.orders.map((order,index)=>{
   const name=order.title.trim()||uiText('生产单第 {value0} 行',{value0:String(order.row)});
   const duplicate=duplicateFor(order.itemId),shots=shotsByOrder.get(order.orderNo.trim())??[];
   const shotCount=shots.length?uiText('{value0} 个镜头',{value0:String(shots.length)}):'';
   const summary=[seriesSummary(order.itemId),shotCount,duplicate&&uiText('可能重复'),problemsText(issues.orders.get(order.row))].filter(Boolean).join(' · ');
   const initial={order,seriesVersionId:seriesValue(order.itemId)};
   return <EpisodeImportPreviewRow key={order.itemId} id={order.itemId} name={name} leading={order.orderNo} trailing={seconds(order.duration)}
    tag={seriesTag(order.itemId)} summary={summary} sheet="orders" row={order.row} initial={initial} editSession={editSession} busy={busy}
    initiallyExpanded={index===0} editingChild={shots.some(shot=>editSession.active===shotKey(shot.row))}
    preview={<>
     {order.sourceText.trim()&&<p className="episode-import-read-text">{order.sourceText}</p>}
     {duplicate}
    </>}
    fields={(draft,setDraft)=><>
     <div className="episode-import-order-fields">
      {orderFields.map(([field,label])=><label key={field}>{uiText(label)}<input name={field} inputMode={field==='duration'?'decimal':undefined} value={draft.order[field]} onChange={event=>setDraft({...draft,order:{...draft.order,[field]:event.target.value}})}/></label>)}
      {seriesFor(order.itemId,draft.seriesVersionId,value=>setDraft({...draft,seriesVersionId:value}))}
     </div>
     <label>{uiText('脚本正文')}<textarea name="sourceText" rows={2} value={draft.order.sourceText} onChange={event=>setDraft({...draft,order:{...draft.order,sourceText:event.target.value}})}/></label>
    </>}
    onSave={draft=>{
     onChange({...workbook,orders:workbook.orders.map(current=>current.itemId===order.itemId?draft.order:current)});
     onSeriesSave(order.itemId,draft.seriesVersionId);
    }}>
    {()=>shots.length>0&&<div className="episode-workbook-shots">
     <h3>{uiText('分镜')} <small>{shotCount}</small></h3>
     {shots.map(shot=>shotPreview(shot))}
    </div>}
   </EpisodeImportPreviewRow>;
  })}
  {unmatchedShots.length>0&&<section className="episode-workbook-unmatched">
   <h3>{uiText('待关联的分镜')}</h3>
   <div className="episode-workbook-shots">{unmatchedShots.map(shot=>shotPreview(shot,true))}</div>
  </section>}
 </>;
}
