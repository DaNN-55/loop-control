import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
import {localRequest} from './client';
import {episodeImportLimits,type EpisodeImportItem,type EpisodeImportReceipt} from './episodeBatchImportTypes';
import './episode-batch-import.css';

type PreviewRow=EpisodeImportItem&{fileError?:string};
type DuplicateCheck={items:Array<{itemId:string;duplicateEpisodeId:string|null;duplicateInBatch:boolean}>};
type ImportPayload={accountId:string;seriesVersionId:string|null;items:EpisodeImportItem[]};
type Props={
 ownerId:string;
 accounts:Array<{id:string;name:string}>;
 series:Array<{id:string;account_id:string;name:string}>;
 seriesVersions:Array<{id:string;series_id:string;version:number}>;
 initialAccountId?:string;
 initialSeriesVersionId?:string;
 onClose:()=>void;
 onCreated:()=>void;
 onOpenEpisode:(episodeId:string)=>void;
};

function post(body:object){
 return localRequest('episode-imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

async function readScriptFile(file:File):Promise<PreviewRow>{
 const row={itemId:crypto.randomUUID(),sourceName:file.name,title:file.name.replace(/\.(txt|md|markdown)$/i,''),sourceText:''};
 if(!/\.(txt|md|markdown)$/i.test(file.name))return {...row,fileError:'请选择 TXT 或 Markdown 文件。'};
 if(file.name.length>episodeImportLimits.sourceNameLength)return {...row,fileError:'文件名过长，请重命名后重新选择。'};
 if(file.size>4*episodeImportLimits.sourceLength+3)return {...row,fileError:'文件过大，请精简后重新选择。'};
 try{
  const sourceText=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
  if(sourceText.includes('\0'))return {...row,fileError:'文件含有无效字符，请另存为 UTF-8 文本后重新选择。'};
  return {...row,sourceText};
 }catch{return {...row,fileError:'无法读取文件，请另存为 UTF-8 文本后重新选择。'};}
}

function itemProblem(row:PreviewRow){
 if(row.fileError)return row.fileError;
 if(!row.title.trim()||row.title.length>200)return '请填写 1–200 字符的标题。';
 if(!row.sourceText.trim())return '请填写脚本正文。';
 if(row.sourceText.length>episodeImportLimits.sourceLength)return '脚本正文不得超过 20,000 字符。';
 return '';
}

export function EpisodeBatchImportDialog({ownerId,accounts,series,seriesVersions,initialAccountId,initialSeriesVersionId,onClose,onCreated,onOpenEpisode}:Props){
 const heading=useId(),fileHelp=useId(),dialog=useRef<HTMLDialogElement>(null),errorFocus=useRef<HTMLDivElement>(null);
 const [accountId,setAccountId]=useState(accounts.find(account=>account.id===initialAccountId)?.id??accounts[0]?.id??'');
 const [seriesVersionId,setSeriesVersionId]=useState(initialSeriesVersionId??'');
 const [rows,setRows]=useState<PreviewRow[]>([]),[duplicates,setDuplicates]=useState<DuplicateCheck|null>(null);
 const previews=useRef(new Map<string,HTMLDetailsElement>());
 useEffect(()=>{
  for(const row of rows){
   const duplicate=duplicates?.items.find(item=>item.itemId===row.itemId);
   const preview=previews.current.get(row.itemId);
   if(preview&&(itemProblem(row)||duplicate?.duplicateEpisodeId||duplicate?.duplicateInBatch))preview.open=true;
  }
 },[duplicates,rows.length]);
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
 const validSeries=seriesChoices.some(choice=>choice.id===seriesVersionId)?seriesVersionId:'';

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
  if(!files.length||running.current)return;
  if(rows.length+files.length>episodeImportLimits.items){problem('每批最多导入 100 份文件。');return;}
  running.current=true;setBusy(true);clearPreview();
  try{
   const added=await Promise.all(files.map(readScriptFile));
   setRows(current=>[...current,...added]);
  }finally{running.current=false;setBusy(false);}
 }
 function edit(id:string,patch:Partial<PreviewRow>){clearPreview();setRows(current=>current.map(row=>row.itemId===id?{...row,...patch}:row));}

 function payload():ImportPayload{
  return {accountId,seriesVersionId:validSeries||null,items:rows.map(({itemId,sourceName,sourceText,title})=>({itemId,sourceName,sourceText,title,duplicate:choices[itemId]??'skip'}))};
 }

 function applyReceipt(result:EpisodeImportReceipt){
  setReceipt(result);
  if(result.items.some(item=>item.status==='succeeded'))onCreated();
 }

 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(running.current||batchId)return;
  if(!rows.length){problem('请先选择脚本文件。');return;}
  const invalid=rows.find(row=>itemProblem(row));
  if(invalid){problem(invalid.sourceName+'：'+itemProblem(invalid));return;}
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
  sessionStorage.removeItem(savedBatchKey);setBatchId('');setReceipt(null);intent.current=null;setRows([]);clearPreview();
 }

 return <dialog ref={dialog} className="modal-card episode-batch-import" aria-labelledby={heading} onCancel={event=>{event.preventDefault();closeDialog();}}>
  <form aria-labelledby={heading} aria-busy={busy} className="episode-batch-form" method="post" onSubmit={event=>void submit(event)}>
   <header>
    <h2 id={heading}>{uiText('批量新建生产单')}</h2>
    <Button size="sm" color="tertiary" type="button" iconLeading={X} aria-label={uiText('关闭批量新建')} isDisabled={busy} onPress={closeDialog}/>
   </header>
   <div className="episode-batch-content">
    <div ref={errorFocus} tabIndex={-1} role="alert">{error&&<p className="form-error">{uiText(error)}</p>}</div>
    {batchId?<section aria-label={uiText('导入结果')}>
     {receipt?<><p role="status">{uiText('成功')} {receipt.items.filter(item=>item.status==='succeeded').length} · {uiText('跳过')} {receipt.items.filter(item=>item.status==='skipped').length} · {uiText('失败')} {receipt.items.filter(item=>item.status==='failed').length}</p>
      <ul className="episode-batch-results">{receipt.items.map(item=><li key={item.itemId}>
       <strong>{item.title}</strong><span>{item.sourceName} · {uiText({succeeded:'成功',skipped:'跳过',failed:'失败',pending:'待处理'}[item.status])}</span>
       {item.reason&&<p>{uiText(item.reason)}</p>}
       {item.episodeId&&<Button size="sm" color="secondary" type="button" onPress={()=>{dialog.current?.close();onOpenEpisode(item.episodeId!);}}>{uiText('打开生产单')}</Button>}
      </li>)}</ul></>:<p>{uiText(busy?'正在读取导入结果…':'正在等待导入结果。')}</p>}
    </section>:<>
     <div className="episode-batch-target">
      <label>{uiText('账号')}<select name="accountId" required disabled={busy} value={accountId} onChange={event=>{setAccountId(event.target.value);setSeriesVersionId('');clearPreview();}}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <label>{uiText('系列')}<select name="seriesVersionId" disabled={busy} value={validSeries} onChange={event=>{setSeriesVersionId(event.target.value);clearPreview();}}><option value="">{uiText('不关联系列')}</option>{seriesChoices.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
     </div>
     <label>{uiText('脚本文件')}<input aria-describedby={fileHelp} name="scripts" type="file" multiple accept=".txt,.md,.markdown" disabled={busy} onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';void addFiles(files);}}/></label>
     <p id={fileHelp} className="field-hint">{uiText('支持 UTF-8 的 TXT 和 Markdown，每份文件新建一张待脚本确认的生产单。')}</p>
     {rows.map(row=>{
      const duplicate=duplicates?.items.find(item=>item.itemId===row.itemId),invalid=itemProblem(row);
      const reviewDuplicate=duplicate?.duplicateEpisodeId||duplicate?.duplicateInBatch;
      return <details key={row.itemId} className="episode-batch-preview" ref={element=>{if(element)previews.current.set(row.itemId,element);else previews.current.delete(row.itemId);}}>
       <summary><strong>{row.title||row.sourceName}</strong><span>{row.sourceName}{invalid?' · '+uiText('需要修正'):reviewDuplicate?' · '+uiText('可能重复'):''}</span></summary>
       <div className="episode-batch-fields">
        <label>{uiText('标题')}<input name="title" aria-invalid={!row.title.trim()||row.title.length>200||undefined} value={row.title} maxLength={200} disabled={busy||!!row.fileError} onChange={event=>edit(row.itemId,{title:event.target.value})}/></label>
        <label>{uiText('脚本正文')}<textarea name="sourceText" aria-invalid={!row.sourceText.trim()||row.sourceText.length>episodeImportLimits.sourceLength||undefined} rows={5} value={row.sourceText} disabled={busy||!!row.fileError} onChange={event=>edit(row.itemId,{sourceText:event.target.value})}/></label>
        {invalid&&<p className="form-error">{uiText(invalid)}</p>}
        {reviewDuplicate&&<label>{uiText('可能重复时')}<select name="duplicate" disabled={busy} value={choices[row.itemId]??'skip'} onChange={event=>setChoices(current=>({...current,[row.itemId]:event.target.value as 'skip'|'create'}))}><option value="skip">{uiText('跳过')}</option><option value="create">{uiText('仍然创建')}</option></select></label>}
        <Button size="sm" color="tertiary" type="button" isDisabled={busy} onPress={()=>{setRows(current=>current.filter(entry=>entry.itemId!==row.itemId));clearPreview();}}>{uiText('移除文件')}</Button>
       </div>
      </details>;
     })}
     {duplicates&&<p role="status">{uiText('重复检查完成，可提交创建。')}</p>}
    </>}
   </div>
   <div className="modal-actions">
    {batchId?<><Button size="sm" color="secondary" type="button" isDisabled={busy||!receipt} onPress={nextBatch}>{uiText('开始新批次')}</Button>
     {(!receipt||receipt.items.some(item=>item.status==='pending'||item.status==='failed'))&&<Button size="sm" color="primary" type="button" isDisabled={busy} onPress={()=>void retry()}>{uiText('重试此批')}</Button>}</>
     :<Button size="sm" color="primary" type="submit" isDisabled={busy}>{uiText(busy?'正在处理…':duplicates?'提交创建':'检查重复')}</Button>}
   </div>
  </form>
 </dialog>;
}
