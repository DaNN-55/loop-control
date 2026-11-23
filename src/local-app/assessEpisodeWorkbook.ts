import {validateStudioDuration} from '../scriptStudio.js';
import {episodeImportLimits,type EpisodeImportItem,type ImportedShot} from './episodeBatchImportTypes.js';
import type {WorkbookPreview,WorkbookShot} from './episodeWorkbookImportTypes.js';

type WorkbookIssue={orders:Map<number,string[]>;shots:Map<number,string[]>};
const durationValue=(text:string)=>text.trim()?(/^\d+(?:\.\d{1,2})?$/.test(text.trim())?Number(text):NaN):null;
function validDuration(value:number|null,optional=false){
 if(value===null)return optional;
 try{validateStudioDuration(value);return true;}catch{return false;}
}
function issue(issues:Map<number,string[]>,row:number,message:string){
 issues.set(row,[...(issues.get(row)??[]),message]);
}
const plain=(text:string,max:number)=>text.length<=max&&!text.includes('\0');

export function assessWorkbook(workbook:WorkbookPreview):{items:EpisodeImportItem[];issues:WorkbookIssue;shotsByOrder:Map<string,WorkbookShot[]>;unmatchedShots:WorkbookShot[]}{
 const issues={orders:new Map<number,string[]>(),shots:new Map<number,string[]>()};
 const orderCount=new Map<string,number>(),shotCount=new Map<string,number>(),shotsByOrder=new Map<string,WorkbookShot[]>(),unmatchedShots:WorkbookShot[]=[];
 for(const order of workbook.orders){
  const number=order.orderNo.trim();
  orderCount.set(number,(orderCount.get(number)??0)+1);
 }
 for(const shot of workbook.shots){
  const key=JSON.stringify([shot.orderNo.trim(),Number(shot.sequence)]);
  shotCount.set(key,(shotCount.get(key)??0)+1);
 }
 for(const shot of workbook.shots){
  const orderNo=shot.orderNo.trim(),sequence=Number(shot.sequence),duration=durationValue(shot.duration);
  const report=(message:string)=>issue(issues.shots,shot.row,message);
  if(!orderNo||!orderCount.has(orderNo))report('找不到对应的生产单。');
  else if(orderCount.get(orderNo)!>1)report('对应的生产单编号重复。');
  if(!/^\d+$/.test(shot.sequence.trim())||!Number.isSafeInteger(sequence)||sequence<1)report('镜头序号须为正整数。');
  else if(shotCount.get(JSON.stringify([orderNo,sequence]))!>1)report('镜头序号重复。');
  if(!validDuration(duration))report('镜头时长须为 0.1–3600 秒，最多两位小数。');
  if(![shot.visual,shot.videoPrompt,shot.narration,shot.caption].some(value=>value.trim()))report('请填写画面、提示词、口播或字幕。');
  if(!plain(shot.videoPrompt,1500))report('视频提示词不得超过 1500 字符或含空字符。');
  if(![shot.visual,shot.narration,shot.caption].every(value=>plain(value,4000)))report('画面、口播和字幕各不得超过 4000 字符或含空字符。');
  if(orderNo&&orderCount.get(orderNo)===1){
   const shots=shotsByOrder.get(orderNo)??[];
   shots.push(shot);
   shotsByOrder.set(orderNo,shots);
  }else unmatchedShots.push(shot);
 }
 for(const shots of shotsByOrder.values())shots.sort((a,b)=>Number(a.sequence)-Number(b.sequence));
 const items=workbook.orders.map(order=>{
  const orderNo=order.orderNo.trim(),targetDuration=durationValue(order.duration);
  const shots=(shotsByOrder.get(orderNo)??[]).map(toImportedShot);
  const report=(message:string)=>issue(issues.orders,order.row,message);
  if(!orderNo)report('请填写生产单编号。');
  else if(orderCount.get(orderNo)!>1)report('生产单编号重复。');
  if(!order.title.trim()||!plain(order.title,200))report('请填写 1–200 字符的标题。');
  if(!plain(order.sourceText,episodeImportLimits.sourceLength))report('脚本正文不得超过 20,000 字符或含空字符。');
  if(!order.sourceText.trim()&&!shots.length)report('请填写脚本正文或关联分镜。');
  if(!validDuration(targetDuration,true))report('目标时长须为 0.1–3600 秒，最多两位小数。');
  if(shots.length>100)report('每张生产单最多 100 个镜头。');
  if(shots.reduce((sum,shot)=>sum+Math.round(shot.durationSeconds*100),0)>360000)report('分镜总时长不能超过 3600 秒。');
  return {itemId:order.itemId,sourceName:workbook.name+' · 生产单第 '+order.row+' 行',title:order.title,sourceText:order.sourceText,targetDuration,shots};
 });
 return {items,issues,shotsByOrder,unmatchedShots};
}

function toImportedShot(shot:WorkbookShot):ImportedShot{
 return {sequence:Number(shot.sequence),visual:shot.visual,videoPrompt:shot.videoPrompt,
  narration:shot.narration,caption:shot.caption,durationSeconds:durationValue(shot.duration)??0};
}
