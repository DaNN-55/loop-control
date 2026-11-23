import {randomUUID} from 'node:crypto';
import {cellValueAsString} from '@office-kit/xlsx/cell';
import {loadWorkbook,workbookToBytes} from '@office-kit/xlsx/io';
import {fromBuffer} from '@office-kit/xlsx/node';
import {addWorksheet,createWorkbook,getSheet,sheetNames} from '@office-kit/xlsx/workbook';
import {appendRows,getCell,getPopulatedRowIndices,getValueExtent,setColumnWidths,setFreezePanes,type Worksheet} from '@office-kit/xlsx/worksheet';
import {ConfigurationError} from './configurationCommands.js';
import {episodeImportLimits} from './episodeBatchImportTypes.js';
import {orderColumns,shotColumns,workbookLimit,type WorkbookPreview} from './episodeWorkbookImportTypes.js';

const maxShots=episodeImportLimits.items*100;
const maxCellLength=32767,maxPreviewBytes=10*1024*1024;
const workbookSheets={orders:'生产单',shots:'分镜'};

export async function episodeWorkbookTemplate(){
 const workbook=createWorkbook();
 const orders=addWorksheet(workbook,workbookSheets.orders),shots=addWorksheet(workbook,workbookSheets.shots);
 appendRows(orders,[[...orderColumns],['示例-01','第一场雨','雨下起来，街角的灯也亮了。',12]]);
 appendRows(shots,[[...shotColumns],
  ['示例-01',1,'雨滴落在玻璃上','用固定特写捕捉聚拢的雨滴','雨下起来了。','雨下起来了',5],
  ['示例-01',2,'街角的灯亮起来','缓慢推向暖色灯光','','街角的灯',7]]);
 setColumnWidths(orders,[20,25,50,15]);setColumnWidths(shots,[20,12,36,36,32,32,15]);
 setFreezePanes(orders,'A2');setFreezePanes(shots,'A2');
 return workbookToBytes(workbook);
}

function readRows(sheet:Worksheet,headers:readonly string[],maximum:number,budget:{bytes:number}){
 const extent=getValueExtent(sheet);
 if(!extent&&sheet.title===workbookSheets.shots)return [];
 const value=(row:number,column:number)=>cellValueAsString(getCell(sheet,row,column)?.value??null);
 if(headers.some((header,index)=>value(1,index+1).trim()!==header)||extent&&extent.maxCol>headers.length){
  throw new ConfigurationError(400,sheet.title+'工作表列名不匹配，请沿用模板第一行。');
 }
 const rows=[];
 for(const row of getPopulatedRowIndices(sheet)){
  if(row===1)continue;
  const fields=headers.map((_,index)=>value(row,index+1));
  if(fields.some(field=>field.length>maxCellLength))throw new ConfigurationError(400,sheet.title+'第 '+row+' 行有超过 Excel 字数上限的单元格。');
  budget.bytes+=Buffer.byteLength(JSON.stringify(fields));
  if(budget.bytes>maxPreviewBytes)throw new ConfigurationError(400,'Excel 展开的文字超过 10 MB，请精简内容后重新选择。');
  if(fields.every(field=>!field.trim()))continue;
  if(rows.length>=maximum)throw new ConfigurationError(400,sheet.title+'工作表行数超过 '+maximum+' 行。');
  rows.push({row,fields});
 }
 return rows;
}

export async function readEpisodeWorkbook(name:unknown,encoded:unknown):Promise<WorkbookPreview>{
 if(typeof name!=='string'||!name.trim()||name.length>220||/[\0\r\n/\\]/.test(name)||!name.toLowerCase().endsWith('.xlsx')||
    typeof encoded!=='string'||!encoded||encoded.length>Math.ceil(workbookLimit/3)*4){
  throw new ConfigurationError(400,'请选择一份 6 MB 以内的 .xlsx 工作簿。');
 }
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.length>workbookLimit||bytes.toString('base64')!==encoded)throw new ConfigurationError(400,'Excel 文件编码无效或超过 6 MB。');
 let workbook;
 try{
  workbook=await loadWorkbook(fromBuffer(bytes),{
   decompressionLimits:{maxTotalUncompressedBytes:24*1024*1024,maxEntryUncompressedBytes:16*1024*1024},
   contentLimits:{maxCells:80000,maxRows:11000},
  });
 }catch{throw new ConfigurationError(400,'无法读取 Excel 工作簿。请使用模板、删除无关内容并另存为普通 .xlsx。');}
 const orders=getSheet(workbook,workbookSheets.orders),shots=getSheet(workbook,workbookSheets.shots);
 if(!orders||!shots||sheetNames(workbook).length!==2)throw new ConfigurationError(400,'请保留模板中的「生产单」和「分镜」两个工作表。');
 const budget={bytes:0};
 const orderRows=readRows(orders,orderColumns,episodeImportLimits.items,budget);
 if(!orderRows.length)throw new ConfigurationError(400,'请在「生产单」工作表填写至少一张生产单。');
 return {name,
  orders:orderRows.map(({row,fields:[orderNo,title,sourceText,duration]})=>({row,itemId:randomUUID(),orderNo,title,sourceText,duration})),
  shots:readRows(shots,shotColumns,maxShots,budget).map(({row,fields:[orderNo,sequence,visual,videoPrompt,narration,caption,duration]})=>({row,orderNo,sequence,visual,videoPrompt,narration,caption,duration})),
 };
}
