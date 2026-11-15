// @vitest-environment node
import {it,expect} from 'vitest';
import {loadSchemaCatalog,verifySchemaLedger,schemaMigrationPlan,freshSchemaTransaction,migrationTransaction,restoredSchemaTable} from './schemaMigrations';
import {planFixtureMigrations} from './fixtureSchema';
const catalog=loadSchemaCatalog(process.cwd());
it('fresh generations do not fabricate legacy migration executions and never replay covered history',()=>{
 const sql=freshSchemaTransaction({...catalog,effective:undefined});expect(sql).toContain("VALUES('clean-v2.sql'");expect(sql).not.toContain("VALUES('002-owner.sql'");
 const applied={[catalog.baseline.version]:catalog.baseline.sha256};expect(verifySchemaLedger(applied,catalog)).toBe('clean-v2');expect(schemaMigrationPlan(applied,catalog,true)).toEqual(catalog.current);expect(schemaMigrationPlan({...applied,...Object.fromEntries(catalog.current.map(f=>[f.version,f.sha256]))},catalog,true)).toEqual([]);
 expect(planFixtureMigrations(applied,[...catalog.legacy,catalog.baseline],['db/local/084-four-step-workspace.sql','db/archive/legacy-v1/087-workspace-narration.sql'])).toEqual([]);
});
it('daily migration preserves the legacy generation until an explicit isolated transition is planned',()=>{
 const applied=Object.fromEntries(catalog.legacy.map(f=>[f.version,f.sha256]));expect(schemaMigrationPlan(applied,catalog)).toEqual([]);
 const plan=schemaMigrationPlan(applied,catalog,true);expect(plan).toHaveLength(1+catalog.current.length);expect(plan[0].body).toBe(catalog.upgrade.body);expect(plan[0].sha256).toBe(catalog.baseline.sha256);
 expect(migrationTransaction(plan)).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
});
it('unknown versions, mutated hashes and incomplete generation mappings fail closed',()=>{
 expect(()=>schemaMigrationPlan({'999-unrecognized.sql':'a'},catalog,true)).toThrow('unknown');
 expect(()=>verifySchemaLedger({'clean-v2.sql':'0'.repeat(64)},catalog)).toThrow('changed');
 const forward=catalog.current.at(-1)!;expect(()=>verifySchemaLedger({'clean-v2.sql':catalog.baseline.sha256,[forward.version]:forward.sha256},catalog)).toThrow('Incomplete');
 const last=catalog.legacy.at(-1)!;expect(()=>schemaMigrationPlan({[last.version]:last.sha256},catalog,true)).toThrow('Incomplete');
 expect(()=>verifySchemaLedger({'clean-v2.sql':catalog.baseline.sha256,[catalog.legacy[0].version]:catalog.legacy[0].sha256},catalog)).toThrow('Incomplete');
});

it('maps only the two archived planning tables during restored row verification',()=>{
 expect(restoredSchemaTable('local_identity.storyboard_planning_defaults')).toBe('local_identity.historical_planning_defaults');
 expect(restoredSchemaTable('local_identity.storyboard_planning_harnesses')).toBe('local_identity.historical_planning_harnesses');
 expect(restoredSchemaTable('public.tasks')).toBe('public.tasks');
});
