// Disposable Owner HTTP/real PostgreSQL fixture. Provider traffic stays on loopback.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {copyFixtureSchema} from './fixtureSchema';
import {createLocalHandler} from './localRoute';
import {LocalConnections} from './connections';
import {createProviderProbe} from './providerProbe';
import {createProviderUsageReader} from './providerUsage';
import {createProviderModelsReader,type ProviderModelsReader} from './providerModels';
import {hashPassword} from './password';
import {csrfFor,tokenHash,sessionCookie} from './sessions';
export async function connectionCatalogFixture(options:{modelsReader?:ProviderModelsReader;billingReader?:import('./providerBilling').BillingReader}={}){
 const {runtimeContext}=await import(process.env.LOOP_TEST_CONTEXT_MODULE??join(process.cwd(),'scripts/runtime/environment.mjs')),context=runtimeContext();context.assertDatabase();
 const database='loop_connections_167_'+randomBytes(6).toString('hex');context.sql('CREATE DATABASE '+database+' TEMPLATE template0','postgres');
 try{await copyFixtureSchema(context,database,['db/local/127-connection-model-settings.sql','db/local/128-connection-model-discovery.sql','db/local/129-bailian-video-models.sql','db/local/132-connection-billing.sql']);}catch(error){context.sql('DROP DATABASE '+database+' WITH(FORCE)','postgres');throw error;}
 const children=new Set<ReturnType<typeof spawn>>();
 const poolFor=(user:string)=>new Pool({database,user,max:4,connectionTimeoutMillis:5000,stream:()=>{
  const child=spawn('docker',['exec','-i',context.container,'perl','-MIO::Socket::UNIX','-MIO::Select','-MSocket=SOCK_STREAM','-e',"my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die;my $sel=IO::Select->new(\\*STDIN,$s);while(1){for my $f($sel->can_read){my $n=sysread($f,my $b,65536);exit unless $n;my $o=fileno($f)==0?$s:\\*STDOUT;while(length $b){my $w=syswrite($o,$b);die unless $w;substr($b,0,$w,'');}}}"],{env:context.env,stdio:['pipe','pipe','pipe']});
  children.add(child);child.once('exit',()=>children.delete(child));const s=Duplex.from({readable:child.stdout!,writable:child.stdin!});return Object.assign(s,{ref(){return s;},unref(){return s;},connect(){queueMicrotask(()=>s.emit('connect'));return s;},setNoDelay(){return s;},setKeepAlive(){return s;}});
 }} as ConstructorParameters<typeof Pool>[0]);
 const admin=poolFor('postgres'),pool=poolFor('loop_app'),root=await mkdtemp('/private/tmp/loop-connections-167-');
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),token=randomBytes(32).toString('hex'),otherToken=randomBytes(32).toString('hex'),password='synthetic-'+randomUUID(),email=owner+'@example.invalid';
 let networkAvailable=true,secretReads=0;const secrets=new Map<string,string>();
 const provider=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/models'&&req.headers.authorization==='Bearer synthetic-openai-key'){res.end(JSON.stringify({data:[{id:'gpt-image-2'},{id:'unadapted-example'}]}));return;}if(req.url==='/freesound-usage?token=synthetic-freesound-key'){res.end(JSON.stringify({current:{sustained:{num:2,limit:'2000/day'}},historic:[['2026-10-31',5],['2026-11-01',3]]}));return;}if(req.url==='/minimax-balance'&&req.headers.authorization==='Bearer sk-api-synthetic-minimax-key'){res.end(JSON.stringify({available_amount:'23.00',cash_balance:'10.00',voucher_balance:'13.00',credit_balance:'0.00',owed_amount:'0.00',base_resp:{status_code:0}}));return;}if(req.url==='/minimax'&&req.headers.authorization==='Bearer synthetic-cn-key'){res.end(JSON.stringify({items:[]}));return;}if(req.headers.authorization!=='Bearer synthetic-openai-key'){res.writeHead(401);res.end('{}');return;}res.end(JSON.stringify({id:'gpt-image-2'}));});
 provider.listen(0,'127.0.0.1');await once(provider,'listening');const providerOrigin='http://127.0.0.1:'+(provider.address() as {port:number}).port;
 const probe=createProviderProbe({directory:'/not-a-production-policy',policySha256:'0'.repeat(64)},async(url,init)=>{if(String(url)==='https://api.minimax.cn/v2/query/video_generation?page_num=1&page_size=1')return fetch(providerOrigin+'/minimax',init);if(String(url)!=='https://api.openai.com/v1/models/gpt-image-2')throw Error('Uncontrolled provider request');return fetch(providerOrigin,init);},undefined,{manualVerification:true});
 const usageReader=createProviderUsageReader(async(url,init)=>{const u=new URL(url);if(u.href==='https://api.minimax.cn/account/query_balance')return fetch(providerOrigin+'/minimax-balance',init);if(u.origin+u.pathname!=='https://freesound.org/apiv2/usage/'||u.searchParams.get('num_days')!=='7')throw Error('Uncontrolled usage request');return fetch(providerOrigin+'/freesound-usage?token='+encodeURIComponent(u.searchParams.get('token')??''),init);});
 const modelsReader=options.modelsReader??createProviderModelsReader(async(url,init)=>{if(String(url)!=='https://api.openai.com/v1/models')throw Error('Uncontrolled models request');return fetch(providerOrigin+'/models',init);});
 const connections=new LocalConnections(pool,{mode:'keychain',async putImmutable(id,value){const old=secrets.get(id);if(old&&old!==value)throw Error('Immutable secret');secrets.set(id,value);},async get(id){secretReads++;const value=secrets.get(id);if(!value)throw Error('Missing synthetic secret');return value;}},{...probe,get networkAvailable(){return networkAvailable;}} ,usageReader,modelsReader,options.billingReader);
 let handler:ReturnType<typeof createLocalHandler>;const server=createServer((q,r)=>handler(q,r));
 async function close(){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));provider.closeAllConnections();await new Promise<void>(done=>provider.close(()=>done()));await Promise.all([pool.end(),admin.end()]);for(const child of children)child.kill();context.sql('DROP DATABASE '+database+' WITH(FORCE)','postgres');await rm(root,{recursive:true,force:true});}
 try{
  await admin.query('INSERT INTO local_identity.owners(id,email)VALUES($1,$2),($3,$4)',[owner,email,other,other+'@example.invalid']);
  await admin.query('INSERT INTO local_identity.credentials(owner_id,password_digest)VALUES($1,$2),($3,$2)',[owner,await hashPassword(password),other]);
  await admin.query("INSERT INTO local_identity.sessions(owner_id,token_hash,expires_at)VALUES($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",[owner,tokenHash(token),other,tokenHash(otherToken)]);
  await admin.query("INSERT INTO public.accounts(id,slug,name,timezone)VALUES($1,$2,'Connection167 fixture','UTC')",[account,'fixture-'+account]);await admin.query("INSERT INTO public.account_memberships(account_id,user_id,role)VALUES($1,$2,'owner')",[account,owner]);
  await admin.query('INSERT INTO local_identity.import_record(imported_at,source_created_at,archive_sha256,source_media_root)VALUES(now(),now(),$1,$2)',['0'.repeat(64),root]);
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;handler=createLocalHandler({pool,origin,mediaRoot:root,connections});
  const request=async(body?:unknown,session=token,csrf=true)=>{const response=await fetch(origin+'/api/local/connections',{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Cookie:sessionCookie+'='+session}:{}),...(csrf&&session?{'X-CSRF-Token':csrfFor(session)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};};
  const command=(command:string,data:Record<string,unknown>,session=token,csrf=true)=>request({command,data,idempotencyKey:randomUUID()},session,csrf);
  return{origin,server,handler,pool,admin,root,owner,other,token,otherToken,password,email,request,command,secrets,get secretReads(){return secretReads;},setNetworkAvailable(value:boolean){networkAvailable=value;},close};
 }catch(error){await close();throw error;}
}
