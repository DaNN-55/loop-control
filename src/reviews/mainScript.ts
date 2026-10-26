export function isValidMainScript(script:string){return /^#\s+\S+/m.test(script)&&/^##\s+正文\s*$/m.test(script)&&!!script.split(/^##\s+正文\s*$/m)[1]?.trim();}
export const mainScriptFormatError='主脚本需包含“# 本期标题”和非空的“## 正文”；可先查看脚本模板。';
