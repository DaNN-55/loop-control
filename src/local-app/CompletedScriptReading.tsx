import {useMemo} from 'react';
import {uiText} from '../i18n/ui';
import {parseProductionScript} from '../reviews/productionScript';
import {MarkdownPreview} from '../ui/MarkdownPreview';

function readingSections(source:string){
 try{
  const script=parseProductionScript(source);
  if(!script)return null;

  // Keep the saved field text, including legacy aliases and explicit defaults.
  const settings:string[]=[],constraints:string[]=[],extraFields=new Map<string,string[]>();
  let lines:string[]|undefined;
  for(const line of source.split(/\r?\n/).map(line=>line.trim())){
   if(/^##\s+制作设置$/.test(line)){lines=settings;continue;}
   if(/^##\s+本期补充约束/.test(line)){lines=constraints;continue;}
   if(/^##\s+正文$/.test(line)){lines=undefined;continue;}
   const paragraph=line.match(/^###\s+段落\s+(\d+)$/)?.[1];
   if(paragraph){lines=[];extraFields.set(paragraph,lines);continue;}
   if(lines&&line&&!/^-\s+(口播|画面提示)[：:]/.test(line))lines.push(line);
  }
  return {script,settings,constraints:constraints.join('\n'),extraFields};
 }catch{return null;}
}

export function CompletedScriptReading({source,status}:{source:string;status:string}){
 const sections=useMemo(()=>readingSections(source),[source]);
 return <div className="completed-script-layout">
  <div className="completed-script-main">
   <header className="completed-script-heading">
    <div><h3>{sections?.script.title||uiText('主脚本')}</h3><span>{status}{uiText(' · 只读')}</span></div>
   </header>
   <div className="workspace-script-preview" role="document" aria-label={uiText('主脚本预览')} tabIndex={0}>
    {sections?<ol className="completed-script-paragraphs">{sections.script.segments.map(segment=>{
     const fields=sections.extraFields.get(segment.paragraph);
     return <li key={segment.id}>
      <span className="completed-script-number" aria-label={uiText('段落 {number}',{number:segment.paragraph})}>{segment.paragraph}</span>
      <div><h4>{segment.narration}</h4>
       {segment.visual&&<p><strong>{uiText('画面提示')}</strong> {segment.visual}</p>}
       {!!fields?.length&&<details><summary>{uiText('制作细节')}</summary><MarkdownPreview content={fields.join('\n')}/></details>}
      </div>
     </li>;
    })}</ol>:<MarkdownPreview content={source}/>}
   </div>
  </div>
  {sections&&<aside className="completed-script-settings" aria-label={uiText('制作设置')}>
   <h4>{uiText('制作设置')}</h4><dl>{sections.settings.map(line=>{
    const field=/^-\s+([^：:]+)[：:]\s*(.*)$/.exec(line);
    return field&&<div key={field[1]}><dt>{uiText(field[1])}</dt><dd>{field[2]||'—'}</dd></div>;
   })}</dl>
   {sections.constraints&&<details><summary>{uiText('本期补充约束')}</summary><MarkdownPreview content={sections.constraints}/></details>}
  </aside>}
 </div>;
}
