// @vitest-environment node
import{afterEach,it,expect,vi}from'vitest';import{mkdtempSync,writeFileSync,readFileSync,rmSync,realpathSync,unlinkSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';
import{createProviderFetcher,type ProviderNetworkConfiguration}from'./providerNetwork';
import{createServer}from'node:http';
import{synthesizeGoogleTts,synthesizeVolcengineTts}from'../worker/mediaProviders';
const dirs:string[]=[];
function fixture(enabled:boolean,maxRequests=1):ProviderNetworkConfiguration{const directory=realpathSync(mkdtempSync(join(tmpdir(),'provider-budget-')));dirs.push(directory);const policy={version:1,runId:'fixture',enabled,expiresAt:'2099-01-01T00:00:00Z',maxRequests,currency:'USD',maxCostMicrounits:100,priceEvidenceSha256:'a'.repeat(64),approvalSha256:'b'.repeat(64),providers:['pexels'],operations:{'pexels.verify':{maxRequests,maxBytes:64,timeoutMs:1000,costMicrounits:0}}};const bytes=JSON.stringify(policy);const policySha256=createHash('sha256').update(bytes).digest('hex');writeFileSync(join(directory,'policy.json'),bytes,{mode:0o600});writeFileSync(join(directory,'state.json'),JSON.stringify({version:1,policySha256,used:0,costMicrounits:0,byOperation:{},halted:false,events:[]}),{mode:0o600});return{directory,policySha256};}
afterEach(()=>{for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true});vi.unstubAllGlobals();});
it('closed authorization never invokes transport or consumes a request',async()=>{const c=fixture(false),transport=vi.fn();const f=createProviderFetcher(c,'pexels','verify',transport);await expect(f('https://api.pexels.com/v1/videos/search')).rejects.toThrow();expect(transport).not.toHaveBeenCalled();expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used).toBe(0);});
it('reserves before transport and refuses a second request without logging credentials',async()=>{const c=fixture(true);let reserved=0;const f=createProviderFetcher(c,'pexels','verify',async()=>{reserved=JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used;return new Response('{}');});await f('https://api.pexels.com/v1/videos/search',{headers:{Authorization:'synthetic-budget-secret'}});expect(reserved).toBe(1);await expect(f('https://api.pexels.com/v1/videos/search')).rejects.toThrow();expect(readFileSync(join(c.directory,'state.json'),'utf8')).not.toContain('synthetic-budget-secret');});
it.each(['redirect','declared-size','stream-size','timeout','transport-error'])('halts and keeps the consumed reservation on %s',async kind=>{
 const c=fixture(true,2),transport=vi.fn(async()=>{if(kind==='transport-error')throw Error('synthetic-private-detail');if(kind==='timeout')return new Promise<Response>(()=>{});if(kind==='redirect')return new Response(null,{status:302,headers:{Location:'https://outside.invalid'}});if(kind==='declared-size')return new Response('x',{headers:{'content-length':'65'}});return new Response('x'.repeat(65));});
 const f=createProviderFetcher(c,'pexels','verify',transport);await expect(f('https://api.pexels.com/v1/videos/search')).rejects.toThrow();await expect(f('https://api.pexels.com/v1/videos/search')).rejects.toThrow();const s=JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8'));expect(s.used).toBe(1);expect(s.halted).toBe(true);expect(transport).toHaveBeenCalledTimes(1);expect(JSON.stringify(s)).not.toContain('synthetic-private-detail');
});
it('rejects wrong hosts and alternate ports without reserving',async()=>{const c=fixture(true),transport=vi.fn(),f=createProviderFetcher(c,'pexels','verify',transport);for(const url of['https://api.pexels.com.evil.invalid/videos/search','https://api.pexels.com:444/videos/search','http://api.pexels.com/v1/videos/search'])await expect(f(url)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used).toBe(0);});
it('binds existing counters to the original authorization digest',async()=>{const c=fixture(true);writeFileSync(join(c.directory,'policy.json'),'{}',{mode:0o600});const f=createProviderFetcher(c,'pexels','verify',vi.fn());await expect(f('https://api.pexels.com/v1/videos/search')).rejects.toThrow();expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used).toBe(0);});

it('cancels the actual transport and records an unknown spent request after caller abort',async()=>{
 let received!:()=>void,closed!:()=>void;
 const requestReceived=new Promise<void>(resolve=>received=resolve),requestClosed=new Promise<void>(resolve=>closed=resolve);
 const server=createServer((request,_response)=>{request.once('close',closed);received();});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('Local HTTP server missing');
  const c=fixture(true,2),caller=new AbortController();let actualSignal:AbortSignal|null|undefined;
  const f=createProviderFetcher(c,'pexels','verify',(_input,init)=>{actualSignal=init?.signal;return fetch(`http://127.0.0.1:${address.port}/pending`,init);});
  const pending=f('https://api.pexels.com/v1/videos/search',{signal:caller.signal,headers:{Authorization:'synthetic-transport-secret'}});
  await requestReceived;caller.abort('synthetic-private-cancellation-reason');
  await expect(pending).rejects.toMatchObject({name:'ProviderOutcomeUnknownError'});
  expect(actualSignal?.aborted).toBe(true);expect(actualSignal?.reason).toBe(caller.signal.reason);
  await requestClosed;
  const state=JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8'));
  expect(state.used).toBe(1);expect(state.halted).toBe(true);expect(state.events.at(-1)).toMatchObject({operation:'pexels.verify',outcome:'unknown'});
  expect(JSON.stringify(state)).not.toContain('synthetic-private-cancellation-reason');expect(JSON.stringify(state)).not.toContain('synthetic-transport-secret');
  await expect(f('https://api.pexels.com/v1/videos/search')).rejects.toThrow();expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used).toBe(1);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it.each(['reserved','unknown'] as const)('keeps a persisted %s outcome blocked without resetting a prior reservation or lock',async outcome=>{
 const c=fixture(true,2),state={version:1,policySha256:c.policySha256,used:1,costMicrounits:0,byOperation:{'pexels.verify':1},halted:outcome==='unknown',events:[{operation:'pexels.verify',outcome}]};
 writeFileSync(join(c.directory,'state.json'),JSON.stringify(state),{mode:0o600});
 if(outcome==='reserved')writeFileSync(join(c.directory,'request.lock'),'previous process reservation',{mode:0o600});
 const before=readFileSync(join(c.directory,'state.json'),'utf8'),transport=vi.fn();
 await expect(createProviderFetcher(c,'pexels','verify',transport)('https://api.pexels.com/v1/videos/search')).rejects.toMatchObject({name:'ProviderOutcomeUnknownError'});
 expect(transport).not.toHaveBeenCalled();expect(readFileSync(join(c.directory,'state.json'),'utf8')).toBe(before);
 if(outcome==='reserved')expect(readFileSync(join(c.directory,'request.lock'),'utf8')).toBe('previous process reservation');
});

it('does not reserve or send a request that was cancelled before dispatch',async()=>{
 const c=fixture(true,2),caller=new AbortController(),transport=vi.fn(async()=>new Response('{}'));
 caller.abort('synthetic-private-before-send');
 await expect(createProviderFetcher(c,'pexels','verify',transport)('https://api.pexels.com/v1/videos/search',{signal:caller.signal})).rejects.toThrow();
 const state=JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8'));
 expect(transport).not.toHaveBeenCalled();expect(state.used).toBe(0);expect(state.costMicrounits).toBe(0);expect(state.events).toEqual([]);
 expect(()=>readFileSync(join(c.directory,'request.lock'))).toThrow();
});

it('retains a completed real HTTP response when the caller aborts after completion',async()=>{
 const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end('{"completed":true}');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('Local HTTP server missing');
  const c=fixture(true,2),caller=new AbortController();
  const f=createProviderFetcher(c,'pexels','verify',(_input,init)=>fetch(`http://127.0.0.1:${address.port}/complete`,init));
  const response=await f('https://api.pexels.com/v1/videos/search',{signal:caller.signal});
  caller.abort('synthetic-private-after-complete');expect(await response.json()).toEqual({completed:true});
  const state=JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8'));
  expect(state.used).toBe(1);expect(state.halted).toBe(false);expect(state.events.at(-1)).toMatchObject({operation:'pexels.verify',outcome:'completed',status:200});
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


it('preserves an unknown result written by another request while waiting for its lock',async()=>{
 const c=fixture(true,2),transport=vi.fn(),statePath=join(c.directory,'state.json'),lock=join(c.directory,'request.lock');
 writeFileSync(lock,'other request owns this lock',{mode:0o600});
 const request=createProviderFetcher(c,'pexels','verify',transport)('https://api.pexels.com/v1/videos/search');
 const state={version:1,policySha256:c.policySha256,used:1,costMicrounits:0,byOperation:{'pexels.verify':1},halted:true,events:[{operation:'pexels.verify',outcome:'unknown'}]};
 const expected=JSON.stringify(state);writeFileSync(statePath,expected,{mode:0o600});unlinkSync(lock);
 await expect(request).rejects.toMatchObject({name:'ProviderOutcomeUnknownError'});
 expect(transport).not.toHaveBeenCalled();expect(readFileSync(statePath,'utf8')).toBe(expected);
 expect(()=>readFileSync(lock)).toThrow();
});


function ttsFixture(provider:'google_tts'|'volcengine_tts',tts?:Record<string,unknown>){
 const c=fixture(true,4),p=JSON.parse(readFileSync(join(c.directory,'policy.json'),'utf8'));
 p.providers=[provider];p.operations={[provider+'.generate']:{maxRequests:4,maxBytes:1024,timeoutMs:1000,costMicrounits:1,...(tts?{tts}:{})}};
 const bytes=JSON.stringify(p);c.policySha256=createHash('sha256').update(bytes).digest('hex');
 writeFileSync(join(c.directory,'policy.json'),bytes,{mode:0o600});writeFileSync(join(c.directory,'state.json'),JSON.stringify({version:1,policySha256:c.policySha256,used:0,costMicrounits:0,byOperation:{},halted:false,events:[]}),{mode:0o600});return c;
}
const ordinaryNarration='走进清晨的森林，放慢脚步，听见风穿过树梢，也看见阳光一点一点照亮前方的道路。';
for(const provider of ['google_tts','volcengine_tts'] as const){
 const alternate=provider==='google_tts'?'cmn-CN-Standard-B':'zh_female_shuangkuaisisi_moon_bigtts';
 const rules={maxCharacters:200,voices:[alternate],...(provider==='google_tts'?{languageCodes:['zh-CN']}:{resourceIds:['seed-tts-1.0']})};
 async function synthesize(c:ProviderNetworkConfiguration,text:string,voice=alternate,transport=vi.fn(async()=>provider==='google_tts'?new Response(JSON.stringify({audioContent:Buffer.from('ID3synthetic').toString('base64')})):new Response('data: '+JSON.stringify({code:0,data:Buffer.from('ID3synthetic').toString('base64')})+'\n'))){
  const fetcher=createProviderFetcher(c,provider,'execute',transport),input={apiKey:'synthetic-only',fetcher,text,voice:{languageCode:'zh-CN',name:voice,speakingRate:1}};
  const bytes=provider==='google_tts'?await synthesizeGoogleTts(input):await synthesizeVolcengineTts({...input,model:'seed-tts-1.0'});return{bytes,transport};
 }
 it(`${provider} executes ordinary narration and the selected voice under explicit production limits`,async()=>{
  const c=ttsFixture(provider,rules),{bytes,transport}=await synthesize(c,ordinaryNarration);
  expect(Buffer.from(bytes).toString()).toBe('ID3synthetic');expect(transport).toHaveBeenCalledTimes(1);
  const [,init]=transport.mock.calls[0] as unknown as [string,RequestInit],body=JSON.parse(String(init.body));
  expect(provider==='google_tts'?body.input.text:body.req_params.text).toBe(ordinaryNarration);
  expect(provider==='google_tts'?body.voice.name:body.req_params.speaker).toBe(alternate);
  expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8'))).toMatchObject({used:1,halted:false,costMicrounits:1});
 });
 it(`${provider} retains the legacy acceptance envelope when production rules are absent`,async()=>{
  const c=ttsFixture(provider);await expect(synthesize(c,ordinaryNarration)).rejects.toThrow();
  await expect(synthesize(c,'短句。')).rejects.toThrow();
  const voice=provider==='google_tts'?'cmn-CN-Standard-A':'zh_female_vv_uranus_bigtts';
  const fetcher=createProviderFetcher(c,provider,'execute',async()=>new Response('ok'));
  const body=provider==='google_tts'?{input:{text:'短句。'},voice:{languageCode:'zh-CN',name:voice},audioConfig:{audioEncoding:'MP3'}}:{req_params:{text:'短句。',speaker:voice}};
  await fetcher(provider==='google_tts'?'https://texttospeech.googleapis.com/v1/text:synthesize':'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse',{method:'POST',headers:{'X-Api-Resource-Id':'seed-tts-2.0'},body:JSON.stringify(body)});
  expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used).toBe(1);
 });
 it(`${provider} refuses production overflow or an unapproved voice before reservation`,async()=>{
  const c=ttsFixture(provider,{...rules,maxCharacters:20});
  await expect(synthesize(c,ordinaryNarration)).rejects.toThrow();await expect(synthesize(c,'短句。','unapproved-voice')).rejects.toThrow();
  expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8'))).toMatchObject({used:0,events:[]});
 });
 it(`${provider} keeps language or resource grants scoped to the signed production policy`,async()=>{
  const mismatch=provider==='google_tts'?{...rules,languageCodes:['en-US']}:{...rules,resourceIds:['seed-tts-2.0']};
  const c=ttsFixture(provider,mismatch);await expect(synthesize(c,'短句。')).rejects.toThrow();expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used).toBe(0);
 });
 it(`${provider} cannot attach production rules to a qualification request`,async()=>{
  const c=ttsFixture(provider,rules),p=JSON.parse(readFileSync(join(c.directory,'policy.json'),'utf8'));p.operations[provider+'.verify']=p.operations[provider+'.generate'];
  const bytes=JSON.stringify(p);c.policySha256=createHash('sha256').update(bytes).digest('hex');writeFileSync(join(c.directory,'policy.json'),bytes,{mode:0o600});
  const state=JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8'));state.policySha256=c.policySha256;writeFileSync(join(c.directory,'state.json'),JSON.stringify(state),{mode:0o600});
  await expect(synthesize(c,'短句。')).rejects.toThrow();expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used).toBe(0);
 });
 it(`${provider} counts Unicode characters and rejects whitespace before spending`,async()=>{
  const c=ttsFixture(provider,{...rules,maxCharacters:2});
  await synthesize(c,'🌲🌲');await expect(synthesize(c,'🌲🌲🌲')).rejects.toThrow();await expect(synthesize(c,'  \n ')).rejects.toThrow();
  expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8'))).toMatchObject({used:1,halted:false});
 });
 it(`${provider} rejects the other provider's production identity fields`,async()=>{
  const foreign=provider==='google_tts'?{resourceIds:['seed-tts-2.0']}:{languageCodes:['zh-CN']};
  const c=ttsFixture(provider,{...rules,...foreign});await expect(synthesize(c,'短句。')).rejects.toThrow();expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used).toBe(0);
 });
 it(`${provider} allows every approved voice within the selected identity set`,async()=>{
  const second=provider==='google_tts'?'cmn-CN-Standard-C':'zh_male_dongfanghaoran_moon_bigtts';
  const c=ttsFixture(provider,{...rules,voices:[alternate,second]});await synthesize(c,'普通口播文本。',second);
  expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8'))).toMatchObject({used:1,halted:false});
 });
 it.each([{...rules,maxCharacters:0},{...rules,maxCharacters:5001},{...rules,voices:[]},{...rules,unexpected:true}])(`${provider} rejects malformed production TTS policy %j`,async invalid=>{
  const c=ttsFixture(provider,invalid);await expect(synthesize(c,'短句。')).rejects.toThrow();expect(JSON.parse(readFileSync(join(c.directory,'state.json'),'utf8')).used).toBe(0);
 });
}
