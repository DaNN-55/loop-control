import {useEffect,useId,useMemo,useRef,useState,type FormEvent} from 'react';
import {Trash2,Upload,X} from 'lucide-react';
import {Badge} from '../ui/dan-ui/components/base/badges/badges';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
import {HelpTip} from '../ui/HelpTip';
import {localRequest} from './client';
import {episodeImportLimits,type EpisodeImportItem,type EpisodeImportReceipt} from './episodeBatchImportTypes';
import {EpisodeWorkbookPreview} from './EpisodeWorkbookPreview';
import {EpisodeImportPreviewRow} from './EpisodeImportPreviewRow';
import {assessWorkbook} from './assessEpisodeWorkbook';
import {workbookLimit,type WorkbookPreview} from './episodeWorkbookImportTypes';
import './episode-batch-import.css';

type PreviewRow=EpisodeImportItem&{seriesName:string;fileError?:string};
type DuplicateCheck={items:Array<{itemId:string;duplicateEpisodeId:string|null;duplicateInBatch:boolean}>};
type ImportPayload={accountId:string;items:EpisodeImportItem[]};
type Props={
 ownerId:string;
 accounts:Array<{id:string;name:string}>;
 series:Array<{id:string;account_id:string;name:string}>;
 seriesVersions:Array<{id:string;series_id:string;version:number}>;
 initialAccountId?:string;
 onClose:()=>void;
 onCreated:()=>void;
 onOpenEpisode:(episodeId:string)=>void;
 onViewBatch:(batchId:string)=>void;
};

function post(body:object){
 return localRequest('episode-imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

async function readScriptFile(file:File):Promise<PreviewRow>{
 const row={itemId:crypto.randomUUID(),sourceName:file.name,title:file.name.replace(/\.(txt|md|markdown)$/i,''),sourceText:'',seriesName:''};
 if(!/\.(txt|md|markdown)$/i.test(file.name))return {...row,fileError:'请选择 TXT 或 Markdown 文件。'};
 if(file.name.length>episodeImportLimits.sourceNameLength)return {...row,fileError:'文件名过长，请重命名后重新选择。'};
 if(file.size>4*episodeImportLimits.sourceLength+3)return {...row,fileError:'文件过大，请精简后重新选择。'};
 try{
  const sourceText=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
  if(sourceText.includes('\0'))return {...row,fileError:'文件含有无效字符，请另存为 UTF-8 文本后重新选择。'};
  const header=/^[ \t]*系列[ \t]*[:：]([^\r\n]*)(?:\r\n|\n|\r|$)/.exec(sourceText);
  return header?{...row,seriesName:header[1].trim(),sourceText:sourceText.slice(header[0].length)}:{...row,sourceText};
 }catch{return {...row,fileError:'无法读取文件，请另存为 UTF-8 文本后重新选择。'};}
}

function workbookBase64(file:File):Promise<string>{
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result).split(',')[1]);
  reader.onerror=()=>reject(new Error('无法读取 Excel 工作簿，请重新选择。'));
  reader.readAsDataURL(file);
 });
}

function itemProblem(row:PreviewRow){
 if(row.fileError)return row.fileError;
 if(!row.title.trim()||row.title.length>200)return '请填写 1–200 字符的标题。';
 if(!row.sourceText.trim())return '请填写脚本正文。';
 if(row.sourceText.length>episodeImportLimits.sourceLength)return '脚本正文不得超过 20,000 字符。';
 return '';
}

export function EpisodeBatchImportDialog({ownerId,accounts,series,seriesVersions,initialAccountId,onClose,onCreated,onOpenEpisode,onViewBatch}:Props){
 const heading=useId(),fileLabel=useId(),fileHelp=useId(),dialog=useRef<HTMLDialogElement>(null),errorFocus=useRef<HTMLDivElement>(null);
 const fileInput=useRef<HTMLInputElement>(null),[dragging,setDragging]=useState(false);
 const [accountId,setAccountId]=useState(accounts.find(account=>account.id===initialAccountId)?.id??accounts[0]?.id??'');
 const [seriesOverrides,setSeriesOverrides]=useState<Record<string,string>>({});
 const [rows,setRows]=useState<PreviewRow[]>([]),[duplicates,setDuplicates]=useState<DuplicateCheck|null>(null);
 const [workbook,setWorkbook]=useState<WorkbookPreview|null>(null);
 const assessment=useMemo(()=>workbook?assessWorkbook(workbook):null,[workbook]);
 const [editingId,setEditingId]=useState<string|null>(null);
 const editSession={active:editingId,onChange:setEditingId};
 const [choices,setChoices]=useState<Record<string,'skip'|'create'>>({});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const savedBatchKey='loop.local.episode-import.'+ownerId;
 const [batchId,setBatchId]=useState(()=>sessionStorage.getItem(savedBatchKey)??'');
 const [receipt,setReceipt]=useState<EpisodeImportReceipt|null>(null);
 const intent=useRef<ImportPayload|null>(null),running=useRef(false);
 const seriesChoices=series.filter(candidate=>candidate.account_id===accountId).flatMap(candidate=>{
  const current=seriesVersions.filter(version=>version.series_id===candidate.id).sort((a,b)=>b.version-a.version)[0];
  return current?[{id:current.id,name:candidate.name}]:[];
 });
 const importRows=workbook?.orders??rows;
 const seriesByItem=new Map(importRows.map(row=>{
  const matches=row.seriesName?seriesChoices.filter(choice=>choice.name.trim()===row.seriesName):[];
  const override=seriesOverrides[row.itemId];
  const selected=seriesChoices.find(choice=>choice.id===override)??(matches.length===1?matches[0]:undefined);
  const value=override==='unassigned'?'unassigned':selected?.id??'';
  const issue=!row.seriesName?'请选择系列。':matches.length>1?'系列重名，请手动选择。':'当前账号下找不到此系列。';
  const message=!value?uiText(issue):'';
  const label=value==='unassigned'?uiText('未分系列'):selected?.name;
  const summary=label?uiText('系列：{value0}',{value0:label}):'';
  const tag=!value?(!row.seriesName?'待选系列':matches.length>1?'系列重名':'未找到系列'):'';
  return [row.itemId,{value,message,summary,tag,sourceSeries:row.seriesName}];
 }));

 const unresolvedSeriesCount=[...seriesByItem.values()].filter(series=>!series.value).length;

 function seriesTag(itemId:string){
  const tag=seriesByItem.get(itemId)?.tag;
  return tag&&<Badge type="color" size="sm" color="warning">{uiText(tag)}</Badge>;
 }


 function seriesIssue(itemId:string){
  const {message,sourceSeries}=seriesByItem.get(itemId)!;
  return message?[sourceSeries,message].filter(Boolean).join(' · '):'';
 }

 function seriesField(itemId:string,value:string,onChange:(value:string)=>void){
  const issue=value?'':seriesIssue(itemId),errorId='import-series-'+itemId;
  return <label>{uiText('系列')}<select name="seriesVersionId" disabled={busy} value={value} aria-invalid={!!issue} aria-describedby={issue?errorId:undefined}
   onChange={event=>onChange(event.target.value)}>
   <option value="" disabled>{uiText('选择系列或未分系列')}</option>
   <option value="unassigned">{uiText('未分系列')}</option>
   {seriesChoices.map(choice=><option key={choice.id} value={choice.id}>{choice.name}{seriesChoices.filter(other=>other.name.trim()===choice.name.trim()).length>1?' · '+choice.id.slice(0,8):''}</option>)}
  </select>
  {issue&&<small id={errorId} className="form-error">{issue}</small>}
  </label>;
 }

 function saveSeries(itemId:string,value:string){
  if(value!==seriesByItem.get(itemId)?.value)setSeriesOverrides(current=>({...current,[itemId]:value}));
 }
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 useEffect(()=>{
  if(!batchId||intent.current)return;
  let active=true;const controller=new AbortController();
  setBusy(true);running.current=true;
  void localRequest('episode-imports/'+batchId,{signal:controller.signal}).then(value=>{
   if(active)setReceipt(value as EpisodeImportReceipt);
  }).catch(cause=>{
   if(!active)return;
   if((cause as {status?:number}).status===404){sessionStorage.removeItem(savedBatchKey);setBatchId('');}
   else setError('导入结果读取失败，请重试此批。');
  }).finally(()=>{if(active){setBusy(false);running.current=false;}});
  return()=>{active=false;controller.abort();running.current=false;};
 },[]);

 function closeDialog(){
  if(running.current)return;
  dialog.current?.close();
  onClose();
 }
 function clearPreview(){setDuplicates(null);setChoices({});setError('');}
 function problem(message:string){setError(message);requestAnimationFrame(()=>errorFocus.current?.focus());}
 async function addFiles(files:File[]){
  if(!files.length||running.current||editingId)return;
  const isWorkbook=files.some(file=>/\.xlsx$/i.test(file.name));
  if(isWorkbook&&(files.length!==1||rows.length)||!isWorkbook&&workbook){
   problem('Excel 每次只导入一份工作簿，请先移除当前文件。');return;
  }
  if(isWorkbook&&files[0].size>workbookLimit){problem('请选择一份 6 MB 以内的 .xlsx 工作簿。');return;}
  if(rows.length+files.length>episodeImportLimits.items){problem('每批最多导入 100 份文件。');return;}
  running.current=true;setBusy(true);clearPreview();
  try{
   if(isWorkbook){
    const file=files[0];
    setWorkbook(await post({action:'readWorkbook',name:file.name,contentBase64:await workbookBase64(file)}));
   }else{
    const added=await Promise.all(files.map(readScriptFile));
    setRows(current=>[...current,...added]);
   }
  }catch(cause){problem(cause instanceof Error?cause.message:'无法读取所选文件。');}
  finally{running.current=false;setBusy(false);}
 }

 function payload():ImportPayload{
  const items=assessment?.items??rows.map(({itemId,sourceName,sourceText,title})=>({itemId,sourceName,sourceText,title}));
  return {accountId,items:items.map(item=>{
   const {value}=seriesByItem.get(item.itemId)!;
   return {...item,seriesVersionId:value==='unassigned'?null:value,duplicate:choices[item.itemId]??'skip'};
  })};
 }

 function duplicateField(itemId:string){
  const duplicate=duplicates?.items.find(item=>item.itemId===itemId);
  if(!duplicate?.duplicateEpisodeId&&!duplicate?.duplicateInBatch)return null;
  return <label>{uiText('可能重复时')}<select name="duplicate" disabled={busy} value={choices[itemId]??'skip'} onChange={event=>setChoices(current=>({...current,[itemId]:event.target.value as 'skip'|'create'}))}><option value="skip">{uiText('跳过')}</option><option value="create">{uiText('仍然创建')}</option></select></label>;
 }

 function applyReceipt(result:EpisodeImportReceipt){
  setReceipt(result);
  if(result.items.some(item=>item.status==='succeeded'))onCreated();
 }

 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(running.current||batchId)return;
  if(editingId){problem('请先保存或取消当前修改。');return;}
  if(!rows.length&&!workbook){problem('请先选择文件。');return;}
  if(assessment&&(assessment.issues.orders.size||assessment.issues.shots.size)){problem('请修正预览中标出的工作表行。');return;}
  const invalid=rows.find(row=>itemProblem(row));
  if(invalid){problem(invalid.sourceName+'：'+itemProblem(invalid));return;}
  if(unresolvedSeriesCount){problem('请在预览中逐条选择系列或「未分系列」。');return;}
  running.current=true;setBusy(true);setError('');
  try{
   const submitted=payload();
   if(!duplicates){setDuplicates(await post({action:'preview',...submitted}));return;}
   const newBatchId=crypto.randomUUID();
   intent.current=submitted;
   sessionStorage.setItem(savedBatchKey,newBatchId);setBatchId(newBatchId);
   try{applyReceipt(await post({action:'submit',batchId:newBatchId,...submitted}));}
   catch(cause){
    const status=(cause as {status?:number}).status;
    if(status&&status<500&&status!==409){
     sessionStorage.removeItem(savedBatchKey);setBatchId('');intent.current=null;throw cause;
    }
    problem('提交结果暂未确认，可重试此批。');
   }
  }catch(cause){problem(cause instanceof Error?cause.message:'无法检查导入内容，请重试。');}
  finally{running.current=false;setBusy(false);}
 }

 async function retry(){
  if(running.current||!batchId)return;
  running.current=true;setBusy(true);setError('');
  try{
   let result:EpisodeImportReceipt;
   try{result=await post({action:'retry',batchId});}
   catch(cause){
    if((cause as {status?:number}).status!==404||!intent.current)throw cause;
    result=await post({action:'submit',batchId,...intent.current});
   }
   applyReceipt(result);
  }catch(cause){problem(cause instanceof Error?cause.message:'导入结果暂未确认，可重试此批。');}
  finally{running.current=false;setBusy(false);}
 }

 function nextBatch(){
  sessionStorage.removeItem(savedBatchKey);setBatchId('');setReceipt(null);intent.current=null;setRows([]);setWorkbook(null);setSeriesOverrides({});clearPreview();
 }

 const hasUploads=!!workbook||rows.length>0;
 const formatHint=uiText('Excel 的时长以秒填写。系列填在「系列」列，或在 TXT、Markdown 首行写「系列：名称」。');
 return <dialog ref={dialog} className="modal-card episode-batch-import" aria-labelledby={heading} onCancel={event=>{event.preventDefault();if(editingId)setEditingId(null);else closeDialog();}}>
  <form aria-labelledby={heading} aria-busy={busy} className="episode-batch-form" method="post" onSubmit={event=>void submit(event)}>
   <header>
    <h2 id={heading}>{uiText('批量新建生产单')}</h2>
    <Button size="sm" color="tertiary" type="button" iconLeading={X} aria-label={uiText('关闭批量新建')} isDisabled={busy||editingId!==null} onPress={closeDialog}/>
   </header>
   <div className="episode-batch-content">
    <div ref={errorFocus} tabIndex={-1} role="alert">{error&&<p className="form-error">{uiText(error)}</p>}</div>
    {batchId?<section aria-label={uiText('导入结果')}>
     {receipt?<><div className="episode-batch-result-summary">
      <p role="status">{uiText('成功')} {receipt.items.filter(item=>item.status==='succeeded').length} · {uiText('跳过')} {receipt.items.filter(item=>item.status==='skipped').length} · {uiText('失败')} {receipt.items.filter(item=>item.status==='failed').length}</p>
      <HelpTip label={uiText('导入结果')} placement="bottom" portalContainer={dialog.current??undefined}>
       <span className="episode-batch-result-help">
        <span>{uiText('跳过：同一账号和系列下已有同标题、同脚本的生产单，且选择了跳过重复项。')}</span>
        <span>{uiText('失败：该条生产单未能创建。查看该条原因，处理后可重试此批。')}</span>
       </span>
      </HelpTip>
     </div>
      <ul className="episode-batch-results">{receipt.items.map(item=><li key={item.itemId}>
       <div className="episode-batch-result-copy">
        <strong>{item.title}</strong><span>{item.sourceName} · {uiText({succeeded:'成功',skipped:'跳过',failed:'失败',pending:'待处理'}[item.status])}</span>
        {item.reason&&<p>{uiText(item.reason)}</p>}
       </div>
       {item.episodeId&&<Button size="sm" color="secondary" type="button" onPress={()=>{dialog.current?.close();onOpenEpisode(item.episodeId!);}}>{uiText('打开生产单')}</Button>}
      </li>)}</ul></>:<p>{uiText(busy?'正在读取导入结果…':'正在等待导入结果。')}</p>}
    </section>:<>
     <div className="episode-batch-import-controls" data-compact={hasUploads||undefined}>
      <div className="episode-batch-target">
       <label>{uiText('账号')}<select name="accountId" required disabled={busy||editingId!==null} value={accountId} onChange={event=>{setAccountId(event.target.value);setSeriesOverrides({});clearPreview();}}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      </div>
      <div className="episode-batch-upload" data-dragging={dragging||undefined}
       onDragOver={event=>{
        if(!event.dataTransfer.types.includes('Files'))return;
        event.preventDefault();
        event.dataTransfer.dropEffect=busy||editingId?'none':'copy';
        if(!busy&&!editingId)setDragging(true);
       }}
       onDragLeave={event=>{
        if(!(event.relatedTarget instanceof Node&&event.currentTarget.contains(event.relatedTarget)))setDragging(false);
       }}
       onDrop={event=>{
        if(!event.dataTransfer.types.includes('Files'))return;
        event.preventDefault();
        setDragging(false);
        if(!busy&&!editingId)void addFiles(Array.from(event.dataTransfer.files));
       }}>
       <button className="episode-batch-upload-slot" type="button" disabled={busy||editingId!==null} aria-labelledby={fileLabel} aria-describedby={fileHelp} onClick={()=>fileInput.current?.click()}>
        <Upload size={hasUploads?16:20} aria-hidden="true"/>
        <strong id={fileLabel}>{uiText(hasUploads?'选择文件':'点击选择或拖入文件')}</strong>
        <small id={fileHelp} className={hasUploads?'sr-only':undefined}>{uiText('多份 UTF-8 TXT、Markdown，或一份 Excel（.xlsx）')}</small>
       </button>
       <input ref={fileInput} hidden name="scripts" type="file" multiple accept=".txt,.md,.markdown,.xlsx" disabled={busy||editingId!==null} onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';void addFiles(files);}}/>
      </div>
     </div>
     {unresolvedSeriesCount>0&&<p className="episode-batch-series-summary" role="status">{uiText('{value0} 张生产单待确认系列。点击对应行的「编辑」选择系列，或选「未分系列」。',{value0:String(unresolvedSeriesCount)})}</p>}
     {workbook&&assessment&&<EpisodeWorkbookPreview workbook={workbook} assessment={assessment} duplicateFor={duplicateField}
      seriesFor={seriesField} seriesValue={itemId=>seriesByItem.get(itemId)!.value} seriesTag={seriesTag}
      seriesSummary={itemId=>seriesByItem.get(itemId)!.summary} onSeriesSave={saveSeries}
      editSession={editSession} busy={busy} onChange={value=>{setWorkbook(value);clearPreview();}} onRemove={()=>{setWorkbook(null);clearPreview();}}/>}
     {rows.map(row=>{
      const duplicate=duplicateField(row.itemId),invalid=itemProblem(row),series=seriesByItem.get(row.itemId)!;
      const initial={title:row.title,sourceText:row.sourceText,seriesVersionId:series.value};
      const summary=[row.title===row.sourceName?'':row.sourceName,series.summary,invalid?uiText('需要修正'):duplicate&&uiText('可能重复')].filter(Boolean).join(' · ');
      return <div key={row.itemId} className="episode-batch-file-preview">
       <EpisodeImportPreviewRow id={row.itemId} name={row.title||row.sourceName} tag={seriesTag(row.itemId)} summary={summary}
        initial={initial} editSession={editSession} busy={busy} allowEdit={!row.fileError} reveal={!!(invalid||duplicate)}
        preview={<>
         {invalid&&<p className="form-error">{uiText(invalid)}</p>}
         {row.sourceText.trim()&&<p className="episode-import-read-text">{row.sourceText}</p>}
         {duplicate}
        </>}
        fields={(draft,setDraft)=><>
         <div className="episode-import-file-fields">
          <label>{uiText('标题')}<input name="title" value={draft.title} maxLength={200} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
          {seriesField(row.itemId,draft.seriesVersionId,value=>setDraft({...draft,seriesVersionId:value}))}
         </div>
         <label>{uiText('脚本正文')}<textarea name="sourceText" rows={2} value={draft.sourceText} onChange={event=>setDraft({...draft,sourceText:event.target.value})}/></label>
        </>}
        onSave={({title,sourceText,seriesVersionId})=>{
         setRows(current=>current.map(entry=>entry.itemId===row.itemId?{...entry,title,sourceText}:entry));
         saveSeries(row.itemId,seriesVersionId);
         clearPreview();
        }}/>
       <Button size="sm" color="tertiary-destructive" type="button" iconLeading={Trash2} aria-label={uiText('移除文件 {value0}',{value0:row.sourceName})} title={uiText('移除文件')} isDisabled={busy||editingId!==null} onPress={()=>{setRows(current=>current.filter(entry=>entry.itemId!==row.itemId));clearPreview();}}/>
      </div>;
     })}
     {duplicates&&<p role="status">{uiText('重复检查完成，可提交创建。')}</p>}
    </>}
   </div>
   <footer className="modal-actions">
    {!batchId&&<details className="episode-batch-upload-format">
     <summary>{uiText('格式说明')}</summary>
     <p className="field-hint">{formatHint}</p>
     <p><a className="episode-workbook-template" download href="/api/local/episode-imports/template.xlsx">{uiText('下载 Excel 模板')}</a></p>
    </details>}
    {batchId?<><Button size="sm" color="secondary" type="button" isDisabled={busy||!receipt} onPress={nextBatch}>{uiText('开始新批次')}</Button>
     {receipt?.items.some(item=>item.status==='succeeded'&&item.episodeId)&&<Button size="sm" color="secondary" type="button" isDisabled={busy} onPress={()=>{dialog.current?.close();onViewBatch(receipt.batchId);}}>{uiText('查看本批')}</Button>}
     {(!receipt||receipt.items.some(item=>item.status==='pending'||item.status==='failed'))&&<Button size="sm" color="primary" type="button" isDisabled={busy} onPress={()=>void retry()}>{uiText('重试此批')}</Button>}</>
     :<Button size="sm" color="primary" type="submit" isDisabled={busy}>{uiText(busy?'正在处理…':duplicates?'提交创建':'检查重复')}</Button>}
   </footer>
  </form>
 </dialog>;
}
