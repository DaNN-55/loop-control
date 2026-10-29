// @vitest-environment node
import{it,expect,vi}from'vitest';
const mocks=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),spawn:vi.fn(),get:vi.fn()}));
vi.mock('node:fs',()=>({readFileSync:mocks.read,existsSync:()=>true,writeFileSync:mocks.write}));
vi.mock('node:child_process',()=>({spawnSync:mocks.spawn}));
vi.mock('./environment.mjs',()=>({root:'/synthetic/runtime',assertPrivatePath:()=>{}}));
vi.mock('./keychain.mjs',()=>({runtimeSecret:mocks.get,keychainState:()=>{}}));
import{putNamedSecret}from'./secrets.mjs';
it('reuses a same-value historical name alias without creating or writing a secret',()=>{
 const reference='00000000-0000-4000-8000-000000000001';
 mocks.read.mockReturnValue(JSON.stringify({version:1,entries:{},nameAliases:{'old-name':{reference}}}));
 mocks.get.mockReturnValue('synthetic-value');
 expect(putNamedSecret('old-name','synthetic-value')).toBe(reference);
 expect(mocks.get).toHaveBeenCalledWith(reference);
 expect(mocks.spawn).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();
});
