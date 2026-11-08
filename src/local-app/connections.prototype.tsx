// Throwaway: three arrangements of the real connection settings components. All API calls are simulated.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Clapperboard,LayoutGrid,Plug,Archive,Users} from 'lucide-react';
import {LocalConnectionsPanel} from './LocalConnectionsPanel';
import {ConnectionPlanningTable} from './WorkspacePlanningSelection';
import {ConnectionPlanningPrototype} from './ConnectionPlanning.prototype';
import './connections.prototype.data';

import '../styles.css';
import '../ui/impeccable/foundation.css';
import '../ui/impeccable/configuration.css';
import '../ui/impeccable/maintenance.css';
import '../ui/impeccable/production.css';
import './production-compact.css';

import './connections.prototype.css';

const variants = ['设置条 + 表格', '双栏管理台', '分区切换'];
function Prototype(){
 const [variant,setVariant]=useState(Math.max(0,['A','B','C'].indexOf(new URLSearchParams(location.search).get('variant')??'')));
 const [section,setSection]=useState(new URLSearchParams(location.search).get('section')==='connections'?'connections':'planning');
 function selectSection(key:string){
   const url=new URL(location.href);url.searchParams.set('section',key);history.replaceState(null,'',url);setSection(key);
 }
 function change(offset:number){
   const next=(variant+offset+variants.length)%variants.length;
   const url=new URL(location.href);url.searchParams.set('variant',['A','B','C'][next]);history.replaceState(null,'',url);setVariant(next);
 }
 return <div className="prototype-shell dan-ui product-ui impeccable-app" data-variant={variant} data-section={section} onKeyDown={event=>{
   if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable],[role="menu"],[role="listbox"],[role="dialog"]'))return;
   if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();change(event.key==='ArrowLeft'?-1:1);}
 }}>
  <aside className="prototype-rail" aria-hidden="true"><b>◯</b><LayoutGrid/><Clapperboard/><Users/><Plug className="active"/><Archive/></aside>
  <header className="prototype-top"><span>个人工作区　›　<strong>连接配置</strong></span><span>交互原型 · 示例数据</span></header>
  <main className="prototype-main">
   <h1>连接配置</h1>
   {variant===2&&<nav aria-label="连接配置分区" className="prototype-tabs">{[['planning','分镜规则'],['connections','外部连接']].map(([key,label])=><button key={key} aria-pressed={section===key} onClick={()=>selectSection(key)}>{label}</button>)}</nav>}
   <section aria-label="连接配置内容" className="maintenance-embedded">
    <div className="maintenance-panel-content connection-settings-content">
     {variant===2?<ConnectionPlanningPrototype/>:<ConnectionPlanningTable initialEpisode={{episodeId:'d47aba50-demo',title:'测试 · d47aba50'}}/>}
     <LocalConnectionsPanel inlineBilling={variant===2}/>
    </div>
   </section>
  </main>
  <div className="prototype-switch" aria-label="原型布局"><button onClick={()=>change(-1)} aria-label="上一种布局">←</button><span role="status">{['A','B','C'][variant]} · {variants[variant]}</span><button onClick={()=>change(1)} aria-label="下一种布局">→</button></div>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Prototype/>);
