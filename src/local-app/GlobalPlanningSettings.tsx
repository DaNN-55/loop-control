import {useEffect,useRef,useState} from 'react';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import type {WorkspacePlanningDraft} from './WorkspacePlanningSelection';
import {localCommand, localRequest} from './client';
import './storyboard-planning-settings.css';

export function GlobalPlanningSettings({demo=false}:{demo?:boolean}={}){
 return <section className="connection-planning storyboard-planning" aria-labelledby="storyboard-planning-title">
   <div className="storyboard-planning-card">
     <header className="storyboard-planning-header">
       <h3 id="storyboard-planning-title">分镜规划默认设置</h3>
       <p>适用于所有账号和生产单。</p>
     </header>
     <PlanningFields key={String(demo)} demo={demo}/>
   </div>
 </section>;
}

type GlobalPlanningDraft={
 revision:number;
 selection:(Omit<NonNullable<WorkspacePlanningDraft['selection']>,'budgetCents'>&{budgetCents:null})|null;
 promptVersions:WorkspacePlanningDraft['promptVersions'];
};

function PlanningFields({demo}:{demo:boolean}){
 const active=useRef(true),running=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const [draft,setDraft]=useState<GlobalPlanningDraft|null>(null);
 const [model,setModel]=useState('gpt-5.6-luna');
 const [harnessId,setHarnessId]=useState('');
 const [layout,setLayout]=useState(()=>demo?(new URLSearchParams(location.search).get('harness')??'side'):'side');
 const [editing,setEditing]=useState(false);
 function selectLayout(value:string){
   const url=new URL(location.href);
   url.searchParams.set('harness',value);
   history.replaceState(null,'',url);
   setLayout(value);setEditing(false);
 }
 const [registering,setRegistering]=useState(false);
 const [registrationStatus,setRegistrationStatus]=useState('');
 const [createdVersion,setCreatedVersion]=useState('');
 const [pending,setPending]=useState(false);
 const [saved,setSaved]=useState(false);
 const [error,setError]=useState('');
 const path=demo?'prototype-global-planning':'storyboard-planning';
 useEffect(()=>{
   let active=true;
   void localRequest(path).then(({planningSelection}: {planningSelection:GlobalPlanningDraft})=>{
     if(!active)return;
     setDraft(planningSelection);
     setHarnessId(planningSelection.selection?.harnessId??'');
     if(planningSelection.selection){
       setModel(planningSelection.selection.model);
     }
   }).catch((cause:Error)=>{if(active)setError(cause.message);});
   return ()=>{active=false;};
 },[path]);
 async function save(){
   if(!draft||running.current)return;
   running.current=true;
   setPending(true);setSaved(false);setError('');
   try{
     // In the demo, null explicitly represents an unlimited budget.
     const accepted=await localCommand<{planningSelection:GlobalPlanningDraft}>('saveGlobalPlanningDefaults',{
       expectedSelectionRevision:draft.revision,
       selection:{provider:'codex',adapter:'codex',model,harnessId,allowedTools:['read','write'],budgetCents:null},
     },undefined,path);
     if(!active.current)return;
     setDraft(accepted.planningSelection);
     setSaved(true);
   }catch(cause){if(active.current)setError((cause as Error).message);}
   finally{if(active.current){running.current=false;setPending(false);}}
 }
 if(!draft)return <p className="storyboard-planning-message" role={error?'alert':'status'}>{error||'正在读取规划配置…'}</p>;
 const harnesses=draft.promptVersions.filter(version=>version.is_active);
 return <>
   <div className="storyboard-planning-fields">
     <label className="storyboard-planning-model">模型
       <InputBase aria-label="分镜规划 模型" size="sm" value={model} isDisabled={pending}
         onChange={event=>{setModel(event.target.value);setSaved(false);}}/>
     </label>
   </div>
   {demo&&<nav className="storyboard-harness-layouts" aria-label="Harness 登记方案">
     {[['inline','A · 列表内新增'],['side','B · 双栏编辑'],['preview','C · 内容预览']].map(([value,label])=>
       <button key={value} type="button" aria-pressed={layout===value} onClick={()=>selectLayout(value)}>{label}</button>)}
   </nav>}
   <div className="storyboard-harness-workbench" data-layout={layout}>
     <div>
     <fieldset className="storyboard-harness">
       <legend>Prompt Harness</legend>
       {harnesses.length===0&&<p>暂无可用版本。</p>}
       {harnesses.map(version=><label key={version.id}>
         <input type="radio" name="storyboard-harness" checked={harnessId===version.id} disabled={pending}
           onChange={()=>{setHarnessId(version.id);setSaved(false);}}/>
         <span><strong>{version.name}</strong><small>{version.slug} · v{version.version}</small>{version.summary&&<small>{version.summary}</small>}</span>
       </label>)}
     </fieldset>
     {layout!=='side'&&<Button size="sm" color="secondary" aria-expanded={editing}
       onPress={()=>setEditing(value=>!value)}>{editing?'收起登记表单':'＋ 登记新版本'}</Button>}
     {layout==='preview'&&<section className="storyboard-harness-preview">
       <h3>所选版本内容</h3>
       <pre>{harnesses.find(version=>version.id===harnessId)?.instructions||'请选择一个版本。'}</pre>
     </section>}
     </div>
   {(layout==='side'||editing)&&<section className="storyboard-version-registration" aria-labelledby="storyboard-version-title">
     <h3 id="storyboard-version-title">登记 Harness 版本</h3>
     <p>现有生产单保留已冻结的版本。新版本登记后可设为默认。</p>
     <form onSubmit={async event=>{
       event.preventDefault();
       if(running.current)return;
       running.current=true;
       const form=event.currentTarget;
       setRegistering(true);setRegistrationStatus('');
       try{
         let id=createdVersion;
         if(!id){
           const fields=new FormData(form);
           const input={name:String(fields.get('name')).trim(),summary:String(fields.get('summary')).trim(),instructions:String(fields.get('instructions')).trim()};
           if(Object.values(input).some(value=>!value)){setRegistrationStatus('请填写版本名称、摘要和 Harness 内容。');return;}
           id=(await localCommand<{id:string}>('createGlobalPromptVersion',input,undefined,path)).id;
           if(!active.current)return;
           setCreatedVersion(id);
         }
         setHarnessId(id);setSaved(false);
         const next=await localRequest(path);
         if(!active.current)return;
         setDraft(next.planningSelection);
         setCreatedVersion('');
         form.reset();
         setRegistrationStatus('新版本已登记并选中，保存默认设置后生效。');
       }catch(cause){if(active.current)setRegistrationStatus((cause as Error).message);}
       finally{if(active.current){running.current=false;setRegistering(false);}}
     }}>
       <label>版本名称<input name="name" required disabled={registering||pending||!!createdVersion}/></label>
       <label>版本摘要<input name="summary" required disabled={registering||pending||!!createdVersion}/></label>
       <label>Harness 内容<textarea name="instructions" rows={4} required disabled={registering||pending||!!createdVersion}/></label>
       <div><Button size="sm" color="secondary" type="submit" isDisabled={registering||pending}>{createdVersion?'重新读取版本':'保存新版本'}</Button>
         {registrationStatus&&<span role="status">{createdVersion?'新版本已登记，列表读取未完成：':''}{registrationStatus}</span>}</div>
     </form>
   </section>}
   </div>
   <footer className="storyboard-planning-footer">
     {error&&<span role="alert">{error}</span>}
     {saved&&<span role="status">已保存全局默认设置</span>}
     <Button size="sm" color="primary" isDisabled={pending||registering||!!createdVersion||!model.trim()||!harnesses.some(version=>version.id===harnessId)} onPress={()=>void save()}>保存默认设置</Button>
   </footer>
 </>;
}
