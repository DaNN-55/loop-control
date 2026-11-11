// In-memory credential flows for the isolated preview. Never calls a business API.
import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {ChevronDown,Copy,Eye,EyeOff,KeyRound,Plug,Search,ShieldCheck} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Toggle} from '../ui/dan-ui/components/base/toggle/toggle';

type DemoVersion={number:number;value:string};
export type DemoConnection={id:string;name:string;provider:string;kind:string;url:string;models:boolean[];versions:DemoVersion[]};
export const demoPassword='demo-password-123';
export function createDemoConnections():DemoConnection[]{
 return [
  {id:'image',name:'图片制作',provider:'图片供应商 A',kind:'图片',url:'https://api.example.com/v1',models:[true,true],versions:[{number:1,value:'demo-key-image-v1'}]},
  {id:'video',name:'视频制作',provider:'视频供应商 B',kind:'视频',url:'https://video.example.com/v1',models:[true,false,true],versions:[{number:1,value:'demo-key-video-v1'}]},
  {id:'voice',name:'口播与配音',provider:'语音供应商 C',kind:'语音',url:'https://voice.example.com/v1',models:[true],versions:[{number:1,value:'demo-key-voice-v1'}]},
 ];
}
function CredentialSection({title,children}:{title:string;children:ReactNode}){return <section className="os-section"><div className="os-section-title"><h3>{title}</h3></div><div className="os-section-content">{children}</div></section>;}
function useDemoOperation(){
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),locked=useRef(false);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);locked.current=false;},[]);
 return {run(action:()=>void){if(locked.current)return false;locked.current=true;timer.current=setTimeout(()=>{timer.current=null;locked.current=false;action();},650);return true;},cancel(){if(timer.current)clearTimeout(timer.current);timer.current=null;locked.current=false;}};
}

export function ConnectionCredentialDemo({records,initialId,empty,onSave,onInspect}:{records:DemoConnection[];initialId:string|null;empty:boolean;onSave:(value:DemoConnection)=>void;onInspect:(reference:string)=>void}){
 const initial=records.find(c=>c.id===initialId)??records[1];
 const [selectedId,setSelectedId]=useState(initial.id),[kind,setKind]=useState(initial.kind);
 const selected=records.find(c=>c.id===selectedId)!,current=selected.versions[0];
 const [name,setName]=useState(initial.name),[models,setModels]=useState(initial.models),[rotation,setRotation]=useState(Boolean(initialId)),[key,setKey]=useState(''),[visible,setVisible]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const keyInput=useRef<HTMLInputElement>(null),operation=useDemoOperation();
 const dirty=name.trim()!==selected.name||models.some((v,i)=>v!==selected.models[i])||rotation&&!!key;
 const sampleKey=`demo-key-${selected.id}-v${current.number+1}`;
 function changeKind(next:string){
  operation.cancel();setBusy(false);setKind(next);setRotation(false);setKey('');setVisible(false);setError('');setNotice('');
  const record=records.find(c=>c.kind===next);if(record){setSelectedId(record.id);setName(record.name);setModels(record.models);}
 }
 function cancel(){operation.cancel();setBusy(false);setKey('');setVisible(false);setError('');setRotation(false);keyInput.current?.blur();}
 function commit(event:FormEvent){
  event.preventDefault();if(busy)return;setNotice('');setError('');
  if(!name.trim()){setError('请填写连接名称。');return;}
  if(rotation&&!key.trim()){setError('请填写新的示例 API Key，或取消更换。');keyInput.current?.focus();return;}
  if(rotation&&!key.startsWith('demo-key-')){setError('这里只接受 demo-key- 开头的示例值，请使用“填入有效示例”。');keyInput.current?.focus();return;}
  const requestedKey=key.trim(),nextName=name.trim(),nextModels=[...models],base=selected;
  if(!operation.run(()=>{
   setBusy(false);
   if(rotation&&requestedKey!==sampleKey){setError('示例密钥验证失败，当前连接仍使用原版本。更换为有效示例后重试。');keyInput.current?.focus();return;}
   const versions=rotation?[{number:current.number+1,value:requestedKey},...base.versions]:base.versions;
   onSave({...base,name:nextName,models:nextModels,versions});setName(nextName);setRotation(false);setKey('');setVisible(false);
   setNotice(rotation?`已验证并保存为 v${current.number+1}；原版本仍可查看。`:'连接修改已保存。');
  }))return;
  setBusy(true);
 }
 return <>
  <div className="os-body">
   <div className="os-connection-tabs" role="group" aria-label="连接能力">{['图片','视频','语音','音乐与音效'].map(value=><button key={value} aria-pressed={kind===value} disabled={busy} onClick={()=>changeKind(value)}>{value}</button>)}</div>
   {empty||kind==='音乐与音效'?<div className="os-empty"><Plug size={24}/><h3>暂无此类连接</h3><p>此预览提供图片、视频与语音连接示例。</p><Button size="sm" color="secondary" onPress={()=>changeKind('视频')}>查看视频示例</Button></div>:<>
    <div className="os-connection-selector"><div className="os-current-connection"><Plug size={18}/><span><strong>{selected.name}</strong><small>{selected.provider} · {selected.models.filter(Boolean).length} 个启用模型</small></span><span className="os-success">已验证 · v{current.number}</span></div></div>
    <form id="os-connection-form" onSubmit={commit}>
     <CredentialSection title="连接信息"><label className="os-field">名称<input maxLength={60} disabled={busy} value={name} onChange={e=>{setName(e.target.value);setNotice('');}}/></label><details className="os-connection-address"><summary>服务地址</summary><p className="os-wrap">{selected.url}</p></details></CredentialSection>
     <CredentialSection title="API Key"><div className="os-task-line"><div><strong>已配置 · v{current.number}</strong><small>不会显示已保存的密钥</small></div>{!rotation&&<Button size="sm" color="secondary" onPress={()=>{setRotation(true);setError('');setNotice('');requestAnimationFrame(()=>keyInput.current?.focus());}}>更换密钥</Button>}</div>
      {rotation&&<div className="os-key-editor"><label className="os-field">新的示例 API Key<div className="os-secret-input"><input ref={keyInput} aria-label="新的示例 API Key" autoComplete="off" maxLength={1024} spellCheck={false} type={visible?'text':'password'} disabled={busy} value={key} aria-invalid={!!error} aria-describedby="os-key-help" onChange={e=>{setKey(e.target.value);setError('');setNotice('');}}/><button type="button" disabled={busy} aria-label={visible?'隐藏新密钥':'显示新密钥'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label><div className="os-fixture"><p id="os-key-help">仅输入示例值，请勿填写真实 API Key。</p><div><button type="button" disabled={busy} onClick={()=>{setKey(sampleKey);setError('');keyInput.current?.focus();}}>填入有效示例</button><button type="button" disabled={busy} onClick={()=>{setKey('demo-key-invalid');setError('');keyInput.current?.focus();}}>填入失效示例</button><button type="button" disabled={busy} onClick={cancel}>取消更换</button></div></div></div>}
      {!rotation&&<Button size="sm" color="tertiary" onPress={()=>onInspect(`${selected.id}-v${current.number}`)}>在密钥管理中查看</Button>}
     </CredentialSection>
     <CredentialSection title="可用模型">{models.map((enabled,index)=><div className="os-row" key={index}><span>{selected.kind}模型 {String.fromCharCode(65+index)}</span><Toggle aria-label={`启用模型 ${String.fromCharCode(65+index)}`} isSelected={enabled} isDisabled={busy} onChange={value=>{setModels(models.map((model,i)=>i===index?value:model));setNotice('');}}/></div>)}</CredentialSection>
     <details className="os-details"><summary>历史版本（{selected.versions.length}）</summary><div className="os-version-list">{selected.versions.map((version,index)=><div className="os-row" key={version.number}><span>v{version.number}<small>{index===0?'当前版本':'历史版本'}</small></span><Button size="sm" color="tertiary" onPress={()=>onInspect(`${selected.id}-v${version.number}`)}>查看此版本密钥</Button></div>)}</div></details>
    </form>
   </>}
  </div>
  <footer role="presentation" className="os-footer"><div className="os-action-feedback">{error?<p role="alert" className="os-danger">{error}</p>:<p role="status" className={notice?'os-success':'os-muted'}>{busy?(rotation?'正在验证示例密钥…':'正在保存…'):notice|| (dirty?'有未保存修改':'')}</p>}</div>{!empty&&kind!=='音乐与音效'&&<div><Button size="sm" color="primary" form="os-connection-form" type="submit" isDisabled={busy||!dirty||!name.trim()} aria-busy={busy}>{busy?(rotation?'验证中…':'保存中…'):rotation?'验证并保存':'保存连接'}</Button></div>}</footer>
 </>;
}

type SecretItem={reference:string;name:string;purpose:string;group:'external'|'system';connectionId:string|null;version:number;current:boolean;value:string|null};
export function SecretCredentialDemo({records,initialReference,empty,onEdit}:{records:DemoConnection[];initialReference:string|null;empty:boolean;onEdit:(id:string)=>void}){
 const [query,setQuery]=useState(''),[group,setGroup]=useState('all'),[selected,setSelected]=useState<string|null>(initialReference);
 const [action,setAction]=useState<'view'|'copy'|null>(null),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [revealed,setRevealed]=useState<{reference:string;value:string;expiresAt:number}|null>(null),[remaining,setRemaining]=useState(0),[copyFailure,setCopyFailure]=useState(false);
 const input=useRef<HTMLInputElement>(null),operation=useDemoOperation(),owner=useRef(0);
 const all:SecretItem[]=[...records.flatMap(record=>record.versions.map((version,index)=>({reference:`${record.id}-v${version.number}`,name:record.name,purpose:`${record.kind}生成`,group:'external' as const,connectionId:record.id,version:version.number,current:index===0,value:version.value}))),{reference:'system-database',name:'应用数据库',purpose:'本机运行',group:'system',connectionId:null,version:1,current:true,value:null}];
 const items=all.filter(item=>!empty&&(group==='all'||item.group===group)&&`${item.name} ${item.purpose} ${item.reference}`.includes(query));
 const item=all.find(value=>value.reference===selected);
 function clear(message=''){owner.current++;operation.cancel();setBusy(false);setAction(null);setPassword('');setError('');setRevealed(null);setRemaining(0);setNotice(message);}
 useEffect(()=>{const hide=()=>{if(document.hidden)clear();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',hide);return()=>{owner.current++;document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',hide);};},[]);
 useEffect(()=>{
  if(!revealed)return;
  const tick=()=>{const seconds=Math.max(0,Math.ceil((revealed.expiresAt-Date.now())/1000));setRemaining(seconds);if(seconds===0)clear('示例密钥已自动隐藏，再次查看需重新验证。');};tick();const timer=setInterval(tick,250);return()=>clearInterval(timer);
 },[revealed]);
 function begin(next:'view'|'copy'){clear();setAction(next);requestAnimationFrame(()=>input.current?.focus());}
 function verify(event:FormEvent){
  event.preventDefault();if(!item?.value||!action||busy)return;
  if(!password){setError('请填写演示密码。');input.current?.focus();return;}
  const accepted=password===demoPassword,requestedAction=action,requestedItem=item,requestOwner=owner.current;
  setError('');setNotice('');
  if(!operation.run(()=>{
   if(requestOwner!==owner.current||document.hidden)return;
   setBusy(false);setPassword('');
   if(!accepted){setError('演示密码不正确，请使用下方提供的示例密码。');input.current?.focus();return;}
   if(requestedAction==='view'){
    setAction(null);setRemaining(30);setRevealed({reference:requestedItem.reference,value:requestedItem.value!,expiresAt:Date.now()+30000});return;
   }
   if(copyFailure||!navigator.clipboard?.writeText){setError('未复制：浏览器未允许访问剪贴板。可重试，或切换为查看后手动复制。');return;}
   setBusy(true);
   void navigator.clipboard.writeText(requestedItem.value!).then(()=>{
    if(requestOwner!==owner.current)return;setAction(null);setBusy(false);setNotice(`已复制“${requestedItem.name} · v${requestedItem.version}”的示例密钥。`);
   }).catch(()=>{if(requestOwner!==owner.current)return;setBusy(false);setError('未复制：浏览器未允许访问剪贴板。可重试，或切换为查看后手动复制。');});
  }))return;
  setBusy(true);
 }
 return <>
  <div className="os-body">
   <div className="os-toolbar"><div className="os-search"><Search size={16}/><input type="search" aria-label="搜索密钥" placeholder="搜索名称、用途或引用编号" value={query} onChange={e=>{clear();setSelected(null);setQuery(e.target.value);}}/></div><select aria-label="密钥分类" value={group} onChange={e=>{clear();setSelected(null);setGroup(e.target.value);}}><option value="all">全部分类</option><option value="external">外部连接</option><option value="system">系统控制</option></select></div>
   <p className="os-note">在这里查看或复制；更换 API Key 请进入对应连接。</p>
   {!items.length?<p className="os-empty">没有匹配的密钥。</p>:items.map(secret=><div className="os-secret" key={secret.reference}>
    <button className="os-secret-row" aria-expanded={selected===secret.reference} onClick={()=>{clear();setSelected(selected===secret.reference?null:secret.reference);}}><KeyRound size={17}/><span><strong>{secret.name}</strong><small>{secret.purpose} · v{secret.version}</small></span><span className={secret.group==='system'?'os-muted':secret.current?'os-success':'os-muted'}>{secret.group==='system'?'系统控制':secret.current?'当前':'历史'}</span><ChevronDown size={14}/></button>
    {selected===secret.reference&&<div className="os-secret-detail">
     <div className="os-row"><span>引用编号</span><code>{secret.reference}</code></div>
     {secret.group==='system'?<p className="os-note">系统控制密钥仅展示用途，不提供查看、复制或修改。</p>:<>
      <div className="os-inline-actions"><Button size="sm" color="secondary" iconLeading={Eye} isDisabled={busy} onPress={()=>begin('view')}>查看密钥</Button><Button size="sm" color="secondary" iconLeading={Copy} isDisabled={busy} onPress={()=>begin('copy')}>复制密钥</Button><Button size="sm" color="tertiary" onPress={()=>{clear();onEdit(secret.connectionId!);}}>前往连接更换密钥</Button></div>
      {action&&<form className="os-credential-verification" onSubmit={verify}><div className="os-verification-heading"><ShieldCheck size={18}/><h3>验证后{action==='view'?'查看':'复制'}密钥</h3></div><label className="os-field">演示登录密码<input ref={input} type="password" autoComplete="off" maxLength={128} value={password} aria-invalid={!!error} disabled={busy} onChange={e=>{setPassword(e.target.value);setError('');}} aria-describedby="os-demo-password-help"/></label><div className="os-fixture"><p id="os-demo-password-help">只使用演示密码，请勿输入真实登录密码。</p><div><button type="button" disabled={busy} onClick={()=>{setPassword(demoPassword);setError('');input.current?.focus();}}>填入演示密码</button>{action==='copy'&&<label><input type="checkbox" checked={copyFailure} disabled={busy} onChange={e=>{setCopyFailure(e.target.checked);setError('');}}/>模拟复制失败</label>}</div></div>{error&&<p className="os-danger" role="alert">{error}</p>}<div className="os-inline-actions"><Button size="sm" color="primary" type="submit" isDisabled={busy||!password} aria-busy={busy}>{busy?'正在验证…':action==='view'?'验证并查看':'验证并复制'}</Button><Button size="sm" color="secondary" isDisabled={busy} onPress={()=>clear()}>取消验证</Button></div></form>}
      {revealed?.reference===secret.reference&&<div className="os-revealed"><div className="os-task-line"><span>{remaining} 秒后自动隐藏</span><Button size="sm" color="tertiary" iconLeading={EyeOff} onPress={()=>clear('示例密钥已隐藏。')}>立即隐藏</Button></div><pre aria-label="示例密钥明文">{revealed.value}</pre><small>这是不可用于调用服务的示例值。</small></div>}
     </>}
    </div>}
   </div>)}
  </div>
  <footer role="presentation" className="os-footer"><p role="status" className={notice?'os-success':'os-muted'}>{notice||`${items.length} 项凭据 · 仅示例数据`}</p></footer>
 </>;
}
