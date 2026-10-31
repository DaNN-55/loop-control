import {it,expect,vi} from 'vitest';
import {nativeStorageContext} from './nativeStorage.fixture';
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
