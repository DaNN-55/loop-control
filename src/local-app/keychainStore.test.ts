import {afterEach,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {configuredKeychainStore} from './keychainStore';
vi.mock('node:child_process',()=>{const api={spawn:vi.fn()};return {...api,default:api};});
vi.mock('node:fs/promises',()=>{const api={lstat:vi.fn(async()=>({uid:process.getuid?.(),mode:0o100700,isSymbolicLink:()=>false,isFile:()=>true})),realpath:vi.fn(async p=>p),readFile:vi.fn(async()=>Buffer.from('synthetic helper bytes'))};return {...api,default:api};});
afterEach(()=>{vi.clearAllMocks();});
const config={approved:true,runtimeRoot:'/tmp/fixture/.loop-control/stage-d',helperSha256:createHash('sha256').update('synthetic helper bytes').digest('hex')};
const reference='10000000-0000-4000-8000-000000000001',secret='synthetic-secret-not-a-real-key';
function mockHelper(respond:(request:Record<string,string>)=>{value:unknown;status:number;stderr?:string}){
 vi.mocked(spawn).mockImplementation((_path,_args,_options)=>{
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),stdin:null as unknown as Writable});let text='';
  child.stdin=new Writable({write(chunk,_encoding,done){text+=String(chunk);done();},final(done){done();queueMicrotask(()=>{const response=respond(JSON.parse(text));if(response.stderr)child.stderr.emit('data',response.stderr);child.stdout.emit('data',JSON.stringify(response.value));child.emit('close',response.status);});}});
  return child as unknown as ReturnType<typeof spawn>;
 });
}
it('does not inspect files or spawn when deployment authorization is disabled',async()=>{
 const store=configuredKeychainStore({...config,approved:false});await expect(store.get(reference)).rejects.toMatchObject({code:'disabled'});expect(readFile).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled();
});
it('passes a secret only through JSON stdin and uses the pinned isolated keychain',async()=>{
 mockHelper(request=>{expect(request).toEqual({operation:'put',reference,secret});return {status:0,value:{ok:true,code:'stored'}};});
 await configuredKeychainStore(config).putImmutable(reference,secret);
 const [helper,args,options]=vi.mocked(spawn).mock.calls[0];expect(helper).toBe(config.runtimeRoot+'/native/keychain-helper');expect(args).toEqual(['--keychain',config.runtimeRoot+'/keychain/t15-synthetic.keychain-db']);expect(options).toMatchObject({env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});expect(JSON.stringify([helper,args,options])).not.toContain(secret);
});
it('requires matching bytes when an immutable reference already exists',async()=>{
 mockHelper(request=>request.operation==='put'?{status:1,value:{ok:false,code:'already_exists'}}:{status:0,value:{ok:true,code:'resolved',secret}});
 const store=configuredKeychainStore(config);await store.putImmutable(reference,secret);await expect(store.putImmutable(reference,'different')).rejects.toMatchObject({code:'conflict'});
});
it('discards stderr and unrecognized native diagnostics without exposing material',async()=>{
 mockHelper(()=>({status:1,stderr:secret,value:{ok:false,code:secret}}));
 const error=await configuredKeychainStore(config).get(reference).catch(e=>e);expect(error.code).toBe('unavailable');expect(String(error)).not.toContain(secret);
});
it('refuses a helper hash mismatch before starting a process',async()=>{
 await expect(configuredKeychainStore({...config,helperSha256:'wrong'}).get(reference)).rejects.toMatchObject({code:'unavailable'});expect(spawn).not.toHaveBeenCalled();
});
