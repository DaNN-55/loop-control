import {useEffect,useState,type FormEvent} from 'react';
import {AccountWorkspace} from '../accounts/AccountWorkspace';
import {AccountForm} from '../accounts/AccountForm';
import type {Json} from '../lib/database.types';
import type {LocalCatalog} from './catalog';
import {localRequest,localCommand} from './client';
type Blueprint=LocalCatalog['blueprints'][number];
export function LocalCatalogApp(){
 const [catalog,setCatalog]=useState<LocalCatalog|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(''),[csrf,setCsrf]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[selectedId,setSelectedId]=useState(''),[newAccount,setNewAccount]=useState(false),[view,setView]=useState<'accounts'|'episodes'>('accounts');
 async function refresh(){const next:LocalCatalog=await localRequest('catalog');setCatalog(next);setSelectedId(id=>next.accounts.some(a=>a.id===id)?id:next.accounts[0]?.id??'');}
 useEffect(()=>{void localRequest('session').then(value=>{setCsrf(value.csrfToken);return refresh();}).catch(()=>setCatalog(null));},[]);
 async function login(event:FormEvent){event.preventDefault();setPending('login');setError('');try{const result=await localRequest('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});setCsrf(result.csrfToken);setPassword('');await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending('');}}
 async function logout(){try{await localRequest('logout',{method:'POST',headers:{'X-CSRF-Token':csrf}});setCatalog(null);setCsrf('');}catch(e){setError(String(e));}}
 async function command<T>(label:string,name:string,data:unknown,revision?:string):Promise<T>{setPending(label);setError('');try{const result=await localCommand<T>(name,data,revision);await refresh();return result;}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setPending('');}}
 const account=catalog?.accounts.find(a=>a.id===selectedId)??null;
 return <main className="local-workspace" style={{maxWidth:1400,margin:'2rem auto',padding:24}}><header><div className="wordmark">Loop Control · 本地</div><h1>内容工作台</h1></header>{error&&<p role="alert" className="form-error">{error}</p>}{!catalog?<form className="access-card" onSubmit={login}><h2>所有者登录</h2><label>邮箱<input aria-label="邮箱" autoComplete="username" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>密码<input aria-label="密码" autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="button button-primary" disabled={!!pending}>使用密码登录</button></form>:<><nav><button className="button" onClick={()=>setView('accounts')}>账号配置</button><button className="button" onClick={()=>setView('episodes')}>生产单目录</button><button className="button" onClick={()=>setNewAccount(true)}>新建账号</button><button className="button" onClick={()=>void refresh().catch(e=>setError(String(e)))}>刷新</button><button className="button" onClick={()=>void logout()}>退出登录</button></nav>{view==='accounts'?<AccountWorkspace account={account} accountEpisodeCount={catalog.episodes.filter(e=>e.account_id===account?.id).length} accounts={catalog.accounts} blueprints={catalog.blueprints} blueprintPreflightError="本地外部连接尚未就绪；相关选择暂时阻塞。生产能力仍需后续运行前检查。" isPending={pending} onSelectAccount={setSelectedId} promptVersions={catalog.promptVersions.filter(p=>p.account_id===account?.id)} series={catalog.series.filter(s=>s.account_id===account?.id)} seriesVersions={catalog.seriesVersions.filter(s=>s.account_id===account?.id)}
 onUpdateBlueprint={async(policy:Json)=>{if(!account)return null;try{return await command<Blueprint>('blueprint','updateBlueprint',{accountId:account.id,policy},catalog.blueprintRevisions[account.current_blueprint_version_id??'']);}catch{return null;}}}
 onCreateSeries={async input=>{if(account)await command('series','createSeries',{accountId:account.id,...input});}}
 onCreateSeriesVersion={async input=>{await command(`series-version-${input.seriesId}`,'createSeriesVersion',input);}}
 onCreatePromptVersion={async input=>{if(!account)return null;try{return await command('prompt-version','createPromptVersion',{accountId:account.id,...input});}catch{return null;}}}
 onRenameAccount={async(id,name)=>{try{await command(`rename-account-${id}`,'renameAccount',{accountId:id,name});return true;}catch{return false;}}}
 onSetAccountArchived={async(id,archived)=>{try{await command(`archive-account-${id}`,'archiveAccount',{accountId:id,archived});return true;}catch{return false;}}}
 onDeleteAccount={async(id,confirmation)=>{try{await command(`delete-account-${id}`,'deleteAccount',{accountId:id,confirmation});return true;}catch{return false;}}}
 />:<section><h2>生产单（{catalog.episodes.length}）</h2><p>导入来源时间：{catalog.sourceCreatedAt}</p><ul>{catalog.episodes.map(e=><li key={e.id}>{e.title} · {e.stage}{e.archived_at?' · 已归档':''}</li>)}</ul></section>}
 {newAccount&&<AccountForm isPending={pending==='account'} onClose={()=>setNewAccount(false)} onSubmit={async input=>{try{const created=await command<LocalCatalog['accounts'][number]>('account','createAccount',input);setSelectedId(created.id);setNewAccount(false);setView('accounts');}catch{/* The visible form error preserves this draft. */}}}/>}</>}</main>;
}
