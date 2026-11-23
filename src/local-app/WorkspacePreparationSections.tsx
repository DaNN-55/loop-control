import type {ReactNode} from 'react';
import {uiText} from '../i18n/ui';

const sections=[['visual','画面'],['voice','字幕与口播'],['sound','音效']] as const;
type Section=typeof sections[number][0];

export function WorkspacePreparationSections({completed,selected,onSelect,children}:{completed:boolean;selected:Section;onSelect:(section:Section)=>void;children:Record<Section,ReactNode>}){
 if(completed)return <div className="completed-shot-sections">
  {sections.map(([id,label])=><section key={id} id={`preparation-panel-${id}`} className={`completed-shot-section completed-shot-${id}`} aria-label={uiText(label)}>
   {id!=='visual'&&<h3>{uiText(label)}</h3>}
   {children[id]}
  </section>)}
 </div>;

 return <>
  <div className="workspace-detail-tabs" role="tablist" aria-label={uiText('素材设置')}>
   {sections.map(([id,label],index)=><button key={id} id={`preparation-tab-${id}`} type="button" role="tab"
    aria-selected={selected===id} aria-controls={`preparation-panel-${id}`} tabIndex={selected===id?0:-1} onClick={()=>onSelect(id)}
    onKeyDown={event=>{
     const next=event.key==='ArrowRight'?sections[(index+1)%3]:event.key==='ArrowLeft'?sections[(index+2)%3]:event.key==='Home'?sections[0]:event.key==='End'?sections[2]:null;
     if(!next)return;
     event.preventDefault();onSelect(next[0]);
     requestAnimationFrame(()=>document.getElementById(`preparation-tab-${next[0]}`)?.focus());
    }}>{uiText(label)}</button>)}
  </div>
  {sections.map(([id])=><div key={id} role="tabpanel" id={`preparation-panel-${id}`} aria-labelledby={`preparation-tab-${id}`} hidden={selected!==id}>{children[id]}</div>)}
 </>;
}
