import {parseProductionScript} from './productionScript.js';
export function mainScriptDiagnostic(script:string):string|null {
  if(!/^#\s+\S+/m.test(script))return '第 1 行：主脚本缺少一级标题，请添加“# 标题”。';
  const body=/^##\s+正文\s*$/m.exec(script);
  if(!body){
    const narrationLine=script.split('\n').findIndex(line=>/^##\s+旁白脚本\s*$/.test(line));
    return narrationLine>=0?`第 ${narrationLine+1} 行：缺少“## 正文”区块；可将“## 旁白脚本”改为“## 正文”。`:'第 1 行：缺少“## 正文”区块，请在正文前添加该标题。';
  }
  if(!script.split(/^##\s+正文\s*$/m)[1]?.trim())return `第 ${script.slice(0,body.index).split('\n').length} 行：“## 正文”下没有内容，请填写正文。`;
  try{parseProductionScript(script);return null;}catch(error){return error instanceof Error?error.message:'主脚本格式无效。';}
}

/** Statistics never normalize or replace the saved source. Spoken text is authoritative only in v2. */
export function mainScriptStatistics(script:string):{characters:number;textCharacters:number|null;textKind:'narration'|'body'} {
  const characters=Array.from(script).length;
  let production;
  try{production=parseProductionScript(script);}catch{return{characters,textCharacters:null,textKind:'narration'};}
  if(production)return{characters,textCharacters:production.segments.reduce((count,segment)=>count+(segment.narration.match(/[\p{L}\p{N}]/gu)?.length??0),0),textKind:'narration'};
  const lines=script.split(/\r?\n/),bodyIndex=lines.findIndex(line=>/^##\s+正文\s*$/.test(line));
  if(bodyIndex<0&&lines.some(line=>/^\s*#{1,3}\s+/.test(line)))return{characters,textCharacters:null,textKind:'body'};
  const body=bodyIndex<0?lines:lines.slice(bodyIndex+1);
  const end=body.findIndex(line=>/^##\s+/.test(line));
  const text=(end<0?body:body.slice(0,end)).filter(line=>!/^\s*#{1,3}\s+/.test(line)).join('\n');
  return{characters,textCharacters:text.match(/[\p{L}\p{N}]/gu)?.length??0,textKind:'body'};
}

/** Each prose paragraph becomes one shot. Headings and other sections stay out of narration. */
export function plainScriptParagraphs(script:string):string[] {
  const lines=script.split(/\r?\n/),bodyIndex=lines.findIndex(line=>/^##[ \t]+正文[ \t]*$/.test(line));
  const body=bodyIndex<0?lines:lines.slice(bodyIndex+1);
  const end=bodyIndex<0?-1:body.findIndex(line=>/^#{1,2}[ \t]+/.test(line));
  return (end<0?body:body.slice(0,end))
    .map(line=>/^\s*#{1,6}[ \t]+/.test(line)?'':line)
    .join('\n').split(/\n[ \t]*\n/).map(paragraph=>paragraph.trim()).filter(Boolean);
}
