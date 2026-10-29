// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {nativeHealth} from './nativeAutomation';
import {assertPreparedRuntime} from '../orchestration/runtimeBuild';
vi.mock('../orchestration/runtimeBuild',()=>({assertPreparedRuntime:vi.fn()}));
const roots:string[]=[];
afterEach(async()=>{vi.resetAllMocks();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function setup(){const mediaRoot=await mkdtemp(join(tmpdir(),'loop-health-checks-'));roots.push(mediaRoot);const query=vi.fn().mockResolvedValue({rows:[{value:1}]});vi.mocked(assertPreparedRuntime).mockResolvedValue(undefined);return{query,options:{pool:{query} as unknown as Pool,projectRoot:'/fixture-project',mediaRoot}};}
it('三项真实边界分别执行并返回简短摘要',async()=>{
 const {options,query}=await setup();const result=await nativeHealth(options);
 expect(query).toHaveBeenCalledWith('SELECT 1');expect(assertPreparedRuntime).toHaveBeenCalledWith('/fixture-project');
 expect(result).toMatchObject({passed:true,detail:'3 项检查通过。',checks:[{id:'database',passed:true},{id:'media_directory',passed:true},{id:'runtime',passed:true}]});
});
it.each([['28P01','认证失败'],['ECONNREFUSED','服务不可达'],['ETIMEDOUT','连接超时'],['unknown','连接或查询失败']])('数据库失败 %s 不跳过媒体和运行程序，也不泄露原始错误',async(code,message)=>{
 const {options,query}=await setup();query.mockRejectedValue(Object.assign(Error('secret-password-and-sql'),{code}));
 const result=await nativeHealth(options);expect(result.passed).toBe(false);expect(result.detail).toBe('1 项检查失败。');
 expect(result.checks?.[0].detail).toContain(message);expect(result.checks?.slice(1).every(check=>check.passed)).toBe(true);expect(assertPreparedRuntime).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain('secret-password');
});
it('媒体不存在与运行产物过期同时失败，仍保存数据库成功',async()=>{
 const {options}=await setup();options.mediaRoot=join(options.mediaRoot,'absent');vi.mocked(assertPreparedRuntime).mockRejectedValue(Error('internal-file-fingerprint'));
 const result=await nativeHealth(options);expect(result).toMatchObject({passed:false,detail:'2 项检查失败。',checks:[{id:'database',passed:true},{id:'media_directory',passed:false,detail:'媒体目录不存在或素材盘未挂载。'},{id:'runtime',passed:false}]});expect(JSON.stringify(result)).not.toContain('internal-file');
});
it('媒体路径为文件时明确指出目录错误',async()=>{
 const {options}=await setup();const file=join(options.mediaRoot,'file');await writeFile(file,'fixture');options.mediaRoot=file;
 const result=await nativeHealth(options);expect(result.checks?.[1]).toMatchObject({passed:false,detail:'媒体路径不是目录。'});
});
