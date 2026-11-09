import type {Pool,PoolClient} from 'pg';

// Observe actual Owner SQL without replacing the database or pg's query overloads.
export function observeWorkspaceReadback(pool:Pool){
 const clients=new WeakSet<PoolClient>();let active:string[]|undefined;
 pool.on('acquire',client=>{
  if(clients.has(client))return;clients.add(client);
  const query=client.query.bind(client) as (...args:any[])=>any;
  client.query=((...args:any[])=>{active?.push(typeof args[0]==='string'?args[0]:args[0]?.text);return query(...args);}) as typeof client.query;
 });
 return async<T>(action:()=>Promise<T>)=>{
  const trace:string[]=[];active=trace;
  try{return{result:await action(),trace,reads:trace.filter(sql=>sql.startsWith('SELECT w.*,e.main_script_revision_id current_script,e.stage episode_stage,p.invalidated_at')).length};}
  finally{active=undefined;}
 };
}
