import {parseProductionScript} from '../reviews/productionScript';

/** Read-only presentation of the original script; never supplies production defaults. */
export function productionCatalogScriptPreview(source:string){
 const text=source.replace(/\r\n?/g,'\n').trim();
 const settingsText=text.split(/^##[ \t]+制作设置[ \t]*$/m)[1]?.split(/^##[ \t]+/m)[0]??'';
 const settings=Array.from(settingsText.matchAll(/^\s*-\s+([^：:\n]+)[：:][ \t]*(.*)$/gm))
  .map(([,label,value])=>({label:label.trim(),value:value.trim()}))
  .filter(item=>item.label!=='模板版本'&&item.value);
 const body=text.split(/^##[ \t]+(?:正文|旁白脚本|口播正文)[ \t]*$/m)[1]?.split(/^##[ \t]+/m)[0]??(settingsText?'':text);
 let summary='';
 try{
  const script=parseProductionScript(text);
  if(script)summary=script.segments.map(segment=>[segment.narration,segment.subtitle,segment.visual,segment.videoPrompt]
   .find(value=>value?.trim()&&!['无','none','关闭'].includes(value.trim()))??'').filter(Boolean).join('\n\n');
 }catch{
  // Historical or incomplete drafts still have a readable preview; validation stays in production.
 }
 if(!summary){
  const narration=Array.from(body.matchAll(/^\s*[-*•]\s*(?:口播|旁白)[：:][ \t]*(.+)$/gm)).map(match=>match[1].trim());
  summary=narration.length?narration.join('\n\n'):body.replace(/^\s*#{1,6}[ \t]+.*$/gm,'').replace(/^[ \t]*[-*•][ \t]+/gm,'').trim();
 }
 const paragraphs=summary.split(/\n\s*\n/).filter(part=>part.trim());
 const characters=Array.from(paragraphs.slice(0,2).join('\n\n'));
 return {summary:characters.slice(0,240).join('')+(characters.length>240||paragraphs.length>2?'…':''),settings};
}
