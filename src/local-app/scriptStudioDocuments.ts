import {crc32,inflateRawSync} from 'node:zlib';
import {basename} from 'node:path';
import {scriptStudioAttachmentMaxBytes,scriptStudioReadAttachmentText,scriptStudioAttachmentMimeForName,scriptStudioAttachmentIsImage,scriptStudioAttachmentIsText,scriptStudioImageMime} from '../scriptStudioAttachments.js';
function invalid():never{throw Error('DOCX内容无效、加密或超过安全解析上限，请另存为普通DOCX或UTF-8文本。');}
const maxEntryBytes=2*1024*1024,maxExpandedBytes=8*1024*1024,maxEntries=256;
function checkedExtra(bytes:Buffer){
 for(let offset=0;offset<bytes.length;){if(offset+4>bytes.length)invalid();const id=bytes.readUInt16LE(offset),length=bytes.readUInt16LE(offset+2);if(id===1||id===0x9901||offset+4+length>bytes.length)invalid();offset+=4+length;}
}
function utf8(bytes:Buffer){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return invalid();}}
/** A small, deliberately restricted ZIP reader. Never extracts a path or follows a relationship. */
function readDocxParts(bytes:Buffer){
 if(bytes.length<22||bytes.length>scriptStudioAttachmentMaxBytes)invalid();
 let end=-1;for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(bytes.readUInt32LE(offset)===0x06054b50&&offset+22+bytes.readUInt16LE(offset+20)===bytes.length){end=offset;break;}
 if(end<0)invalid();
 const count=bytes.readUInt16LE(end+10),directorySize=bytes.readUInt32LE(end+12),directoryStart=bytes.readUInt32LE(end+16);
 if(bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0||bytes.readUInt16LE(end+8)!==count||count<2||count>maxEntries||directoryStart+directorySize!==end||directoryStart===0xffffffff||directorySize===0xffffffff)invalid();
 const entries:{name:string;start:number;stop:number;data:Buffer}[]=[],names=new Set<string>();let cursor=directoryStart,expanded=0;
 for(let index=0;index<count;index++){
  if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)invalid();
  const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),compressedSize=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24),nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32),start=bytes.readUInt32LE(cursor+42),entryEnd=cursor+46+nameLength+extraLength+commentLength;
  if(flags&~0x080e||![0,8].includes(method)||bytes.readUInt16LE(cursor+34)!==0||(bytes.readUInt32LE(cursor+38)>>>16&0xf000)===0xa000||entryEnd>end||!nameLength||size>maxEntryBytes||compressedSize===0xffffffff||start===0xffffffff||size>Math.max(1,compressedSize)*200)invalid();
  expanded+=size;if(expanded>maxExpandedBytes)invalid();
  const nameBytes=bytes.subarray(cursor+46,cursor+46+nameLength),name=utf8(nameBytes);
  if(name.startsWith('/')||name.includes('\\')||name.includes('\0')||name.split('/').some(part=>part==='.'||part==='..')||names.has(name))invalid();names.add(name);
  checkedExtra(bytes.subarray(cursor+46+nameLength,cursor+46+nameLength+extraLength));
  if(start+30>directoryStart||bytes.readUInt32LE(start)!==0x04034b50||bytes.readUInt16LE(start+6)!==flags||bytes.readUInt16LE(start+8)!==method)invalid();
  const localNameLength=bytes.readUInt16LE(start+26),localExtraLength=bytes.readUInt16LE(start+28),dataStart=start+30+localNameLength+localExtraLength;
  if(dataStart+compressedSize>directoryStart||!bytes.subarray(start+30,start+30+localNameLength).equals(nameBytes))invalid();
  checkedExtra(bytes.subarray(start+30+localNameLength,dataStart));
  for(const [offset,expected]of [[14,crc],[18,compressedSize],[22,size]])if(bytes.readUInt32LE(start+offset)!==expected&&(!(flags&8)||bytes.readUInt32LE(start+offset)!==0))invalid();
  let stop=dataStart+compressedSize;
  if(flags&8){if(stop+12>directoryStart)invalid();if(bytes.readUInt32LE(stop)===0x08074b50)stop+=4;if(stop+12>directoryStart||bytes.readUInt32LE(stop)!==crc||bytes.readUInt32LE(stop+4)!==compressedSize||bytes.readUInt32LE(stop+8)!==size)invalid();stop+=12;}
  const compressed=bytes.subarray(dataStart,dataStart+compressedSize);let data:Buffer;
  try{data=method===0?compressed:inflateRawSync(compressed,{maxOutputLength:maxEntryBytes});}catch{return invalid();}
  if(data.length!==size||crc32(data)!==crc)invalid();
  entries.push({name,start,stop,data});cursor=entryEnd;
 }
 if(cursor!==end)invalid();
 const ranges=[...entries].sort((a,b)=>a.start-b.start);let stop=0;for(const entry of ranges){if(entry.start!==stop)invalid();stop=entry.stop;}if(stop!==directoryStart)invalid();
 return new Map(entries.map(entry=>[entry.name,entry.data]));
}
function xmlText(value:string){
 if(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[a-f0-9]+;)/i.test(value)||value.includes('<'))invalid();
 return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[a-f0-9]+);/gi,(_,entity:string)=>{
  const known:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(known[entity])return known[entity];
  const code=entity[1]==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));if(!Number.isSafeInteger(code)||code<1||code>0x10ffff||code>=0xd800&&code<=0xdfff)invalid();return String.fromCodePoint(code);
 });
}
/** Only ordinary w:body/w:t text is supplied; embedded media, macros and links are never evaluated. */
export function readScriptStudioDocx(bytes:Buffer):string{
 const parts=readDocxParts(bytes),documentBytes=parts.get('word/document.xml'),contentTypeBytes=parts.get('[Content_Types].xml');if(!documentBytes||!contentTypeBytes)invalid();
 const xml=utf8(documentBytes),contentTypes=utf8(contentTypeBytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(xml+contentTypes)||!contentTypes.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')||!/<w:document\b/.test(xml))invalid();
 const body=/<w:body(?:\s[^>]*)?>([\s\S]*?)<\/w:body\s*>/.exec(xml)?.[1];if(body===undefined)invalid();
 const text=[...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t\s*>|<\/w:p\s*>|<w:(?:tab|br)\b[^>]*\/>/g)].map(token=>token[1]!==undefined?xmlText(token[1]):token[0].includes('tab')?'\t':'\n').join('').trim();
 try{return scriptStudioReadAttachmentText(Buffer.from(text),'text/plain');}catch(error){throw Error('DOCX：'+(error as Error).message);}
}
/** Basic envelope checks only. The native model provider validates the complete PDF structure. */
export function validateScriptStudioPdf(bytes:Buffer){
 if(!bytes.length||bytes.length>scriptStudioAttachmentMaxBytes||!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(bytes.subarray(0,16).toString('latin1'))||!/%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1'))||/\/Encrypt\b/.test(bytes.toString('latin1')))throw Error('PDF文件无效、未完整结束或已加密，请重新导出未加密的PDF。');
}

/** Opt-in import validation: other reference imports retain their existing acceptance contract. */
export function validateScriptStudioAttachmentUpload(bytes:Buffer,input:{sourcePath:string;logicalName?:string;sourceKind?:string;materialType:string;mimeType:string;materialPurpose:string;isMainScript:boolean}){
 const name=basename(input.logicalName??input.sourcePath),mime=scriptStudioAttachmentMimeForName(name),image=!!mime&&scriptStudioAttachmentIsImage(mime);
 if(!mime||!bytes.length||bytes.length>scriptStudioAttachmentMaxBytes||input.sourceKind!=='file'||input.isMainScript||input.materialType!==(image?'image':'reference')||input.materialPurpose!==(image?'visual_reference':'general_reference')||!['application/octet-stream',mime].includes(input.mimeType.toLowerCase().split(';')[0].trim()))throw Error('附件格式、用途或大小无效，单个不超过10 MiB。');
 if(image){if(scriptStudioImageMime(bytes)!==mime)throw Error('图片真实类型与扩展名不一致。');}
 else if(mime==='application/pdf')validateScriptStudioPdf(bytes);
 else if(scriptStudioAttachmentIsText(mime))scriptStudioReadAttachmentText(bytes,mime);
 else readScriptStudioDocx(bytes);
 return mime;
}
