import {useEffect,useState,type FormEvent} from 'react';
import {createClient} from '@supabase/supabase-js';
import type {LocalCatalog} from './catalog';
// T12 bridge validates identity only; business reads never use this client.
const identity=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
export function LocalCatalogApp(){
 const [catalog,setCatalog]=useState<LocalCatalog|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 async function refresh(){
  const {data}=await identity.auth.getSession();if(!data.session){setCatalog(null);return;}
  const response=await fetch('/api/local/catalog',{headers:{Authorization:`Bearer ${data.session.access_token}`}});
  const value=await response.json();if(!response.ok)throw Error(value.error);setCatalog(value);
 }
 useEffect(()=>{void refresh().catch(e=>setError(String(e)));},[]);
 async function login(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{const result=await identity.auth.signInWithPassword({email,password});if(result.error)throw result.error;setPassword('');await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <main style={{maxWidth:1000,margin:'3rem auto',padding:24}}><h1>Loop Control · 本地目录</h1><p>业务目录：本地 PostgreSQL。当前阶段仅开放目录读取。</p>{error&&<p role="alert">{error}</p>}{!catalog?<form onSubmit={login}><h2>所有者登录</h2><label>邮箱<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>密码<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>登录</button></form>:<><p>导入来源时间：{catalog.sourceCreatedAt}</p><button onClick={()=>void refresh().catch(e=>setError(String(e)))}>刷新目录</button><button onClick={()=>void identity.auth.signOut().then(()=>setCatalog(null))}>退出登录</button><h2>账号（{catalog.accounts.length}）</h2>{catalog.accounts.map(a=><section key={a.id}><h3>{a.name}</h3><h4>系列</h4><ul>{catalog.series.filter(s=>s.account_id===a.id).map(s=><li key={s.id}>{s.name}</li>)}</ul><h4>生产单</h4><ul>{catalog.episodes.filter(e=>e.account_id===a.id).map(e=><li key={e.id}>{e.title} · {e.stage}{e.archived_at?' · 已归档':''}</li>)}</ul></section>)}</>}</main>;
}
