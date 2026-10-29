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
export function isValidMainScript(script:string){return mainScriptDiagnostic(script)===null;}
export const mainScriptFormatError='主脚本需包含“# 本期标题”和非空的“## 正文”；可先查看脚本模板。';
