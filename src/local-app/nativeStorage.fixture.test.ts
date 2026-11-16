// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {nativeStorageContext} from './nativeStorage.fixture';

const source='loop_t24_restore_0123456789ab',target='loop_t24_restore_abcdef012345';
function context(){return{database:'loop_t12_baseline',container:'not-used-by-native',env:{},docker:vi.fn(()=>{throw Error('Docker is not a native transport');}),sql:vi.fn(()=>'native SQL'),assertDatabase:vi.fn(),dailyRuntime:false,isolatedFixtureNative:true,nativeConnection:{host:'/private/owned/socket',port:5432},execTool:vi.fn(()=>'native output'),spawnTool:vi.fn(()=>({pid:123}))};}

it('requires an owned isolated native capability and a distinct random restore pair',()=>{
 const c=context();
 for(const altered of [{...c,dailyRuntime:true},{...c,isolatedFixtureNative:false},{...c,nativeConnection:undefined},{...c,spawnTool:undefined}])expect(()=>nativeStorageContext(altered,'/private/owned',source,target)).toThrow('isolated owned');
 for(const pair of [[source,source],['loop_control',target],[source,'loop_t24_restore_invalid']])expect(()=>nativeStorageContext(c,'/private/owned',pair[0],pair[1])).toThrow('isolated owned');
 expect(c.execTool).not.toHaveBeenCalled();expect(c.docker).not.toHaveBeenCalled();
});

it('forwards native custom archives and descriptor output unchanged without Docker',()=>{
 const c=context(),storage=nativeStorageContext(c,'/private/owned',source,target),exec=storage.execTool as (...args:unknown[])=>unknown;
 const archive=Buffer.from([0x50,0x47,0x44,0x4d,0x50,0,255]),decode=['--data-only','--no-owner','--no-privileges','--file=-'];
 expect(exec('pg_restore',decode,archive,{encoding:undefined})).toBe('native output');expect(c.execTool).toHaveBeenLastCalledWith('pg_restore',decode,archive,{encoding:undefined});
 const args=['-d',source,'-Fc','--schema=public','--schema=local_identity','--schema=loop_internal','--schema=extensions','--exclude-table-data=local_identity.credentials','--exclude-table-data=local_identity.sessions','--snapshot=00000003-00000014-1'],options={maxBuffer:1024,stdio:['ignore',42,'pipe']};
 exec('pg_dump',args,undefined,options);expect(c.execTool).toHaveBeenLastCalledWith('pg_dump',args,undefined,options);
 storage.spawnTool!('psql',['-XqAt','-d',source,'-v','ON_ERROR_STOP=1']);expect(c.spawnTool).toHaveBeenCalledTimes(1);expect(c.docker).not.toHaveBeenCalled();
});

it('rejects foreign databases, connection overrides and option overrides before the tool port',()=>{
 const c=context(),storage=nativeStorageContext(c,'/private/owned',source,target),exec=storage.execTool as (...args:unknown[])=>unknown;
 for(const args of [['-XqAt','-d','loop_control','-v','ON_ERROR_STOP=1'],['-XqAt','-d',source,'-v','ON_ERROR_STOP=1','-d','loop_control'],['-XqAt','-d',source,'-v','ON_ERROR_STOP=1','-h','foreign']])expect(()=>exec('psql',args,'SELECT 1')).toThrow('Foreign storage fixture');
 expect(()=>exec('pg_restore',['--dbname=loop_control'],Buffer.from('archive'))).toThrow('Foreign storage fixture');
 for(const options of [{env:{PGHOST:'foreign'}},{input:'DROP DATABASE loop_control'},{shell:true}])expect(()=>exec('psql',['-XqAt','-d',source,'-v','ON_ERROR_STOP=1'],'SELECT 1',options)).toThrow('Foreign storage fixture tool options');
 expect(()=>storage.spawnTool!('psql',['-XqAt','-d','postgres','-v','ON_ERROR_STOP=1'])).toThrow('Foreign storage fixture database');
 expect(c.execTool).not.toHaveBeenCalled();expect(c.spawnTool).not.toHaveBeenCalled();
});

it('keeps maintenance catalog SQL inside the explicitly owned restore pair',()=>{
 const c=context(),storage=nativeStorageContext(c,'/private/owned',source,target);
 expect(storage.sql('CREATE DATABASE '+target+' TEMPLATE template0','postgres')).toBe('native SQL');expect(c.sql).toHaveBeenLastCalledWith('CREATE DATABASE '+target+' TEMPLATE template0','postgres');
 expect(()=>storage.sql('DROP DATABASE loop_control WITH (FORCE)','postgres')).toThrow('Unapproved storage fixture catalog');
 expect(()=>storage.sql('SELECT 1','loop_control')).toThrow('Foreign storage fixture database');
 expect(()=>storage.docker(['exec','fake','psql'])).toThrow('do not use Docker');
});

it('the restore fixture rejects daily identity, foreign databases and expanded catalog or docker statements',()=>{
 const base={dailyRuntime:false,container:'loop-control-178-test-postgres',database:'loop_178_baseline',env:{},assertDatabase:vi.fn(),sql:vi.fn(),docker:vi.fn(()=> '0')},source='loop_t24_restore_0123456789ab',target='loop_t24_restore_abcdef012345';
 expect(()=>nativeStorageContext({...base,dailyRuntime:true},'/private/tmp/owned',source,target)).toThrow('isolated');
 expect(()=>nativeStorageContext({...base,container:'loop-control-local-postgres'},'/private/tmp/owned',source,target)).toThrow('isolated');
 const context=nativeStorageContext(base,'/private/tmp/owned',source,target);
 for(const text of ['SELECT * FROM pg_database',`ALTER DATABASE loop_control SET loop.restore_state='ready'`,`ALTER DATABASE ${target} SET loop.restore_state='ready'; DROP DATABASE loop_control`])expect(()=>context.sql(text,'postgres')).toThrow('Unapproved');
 expect(()=>context.sql('SELECT 1','loop_control')).toThrow('Foreign');
 expect(()=>context.docker(['exec',base.container,'psql','-d','loop_control'],'SELECT 1')).toThrow('Foreign');
 expect(()=>context.docker(['exec',base.container,'psql','-d','postgres'],'DROP DATABASE loop_control')).toThrow('Foreign');
 expect(()=>context.docker(['exec','loop-control-local-postgres','pg_restore','--file=-'])).toThrow('Foreign');
 expect(()=>context.docker(['exec','foreign-container','echo',base.container,'pg_restore','--file=-'])).toThrow('Foreign');
 expect(()=>context.docker(['exec',base.container,'pg_restore','--dbname=foreign_database'])).toThrow('Foreign');
 expect(base.sql).not.toHaveBeenCalled();expect(base.docker).not.toHaveBeenCalled();
 expect(context.sql(`SELECT count(*) FROM pg_database WHERE datname='${target}'`,'postgres')).toBe('0');expect(base.docker).toHaveBeenCalledOnce();
});
