// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {loadSchemaCatalog,freshSchemaTransaction,verifySchemaLedger,schemaMigrationPlan} from './schemaMigrations';
import {planFixtureMigrations} from './fixtureSchema';
const catalog=loadSchemaCatalog(process.cwd());
const forwards=catalog.current.filter(file=>!Object.hasOwn(catalog.effective!.covered,file.version));
it('fresh clean-v3 records only its real execution; old forward ledgers stay unchanged',()=>{
 const effective=catalog.effective!;
 expect(effective.baseline.version).toBe('clean-v3.sql');
 const sql=freshSchemaTransaction(catalog);expect(sql).toContain("VALUES('clean-v3.sql'");expect(sql).not.toContain("VALUES('clean-v2.sql'");expect(sql).not.toContain("VALUES('199-");
 const applied={[effective.baseline.version]:effective.baseline.sha256};expect(verifySchemaLedger(applied,catalog)).toBe('clean-v3');expect(schemaMigrationPlan(applied,catalog,true)).toEqual(forwards);
 for(const forward of forwards)expect(sql).toContain(`VALUES('${forward.version}'`);
 const old={[catalog.baseline.version]:catalog.baseline.sha256,...effective.covered};delete old['clean-v3.sql'];
 expect(verifySchemaLedger(old,catalog)).toBe('clean-v2');expect(schemaMigrationPlan(old,catalog,true)).toEqual(forwards);
 expect(planFixtureMigrations(applied,[...catalog.legacy,catalog.baseline,...catalog.current,effective.baseline],['db/local/084-four-step-workspace.sql'])).toEqual([]);
});
it('prefix fixtures use original migrations; new forwards remain pending; mixed ledgers fail closed',()=>{
 const effective=catalog.effective!,applied={[effective.baseline.version]:effective.baseline.sha256};
 const prefix={...catalog,current:catalog.current.filter(file=>Object.hasOwn(effective.covered,file.version)).slice(0,-1)};expect(freshSchemaTransaction(prefix)).toContain("VALUES('clean-v2.sql'");
 const forward={version:'999-fixture.sql',body:'SELECT 1;',sha256:'a'.repeat(64)};
 expect(schemaMigrationPlan(applied,{...catalog,current:[...catalog.current,forward]},true)).toEqual([...forwards,forward]);
 expect(()=>verifySchemaLedger({...applied,[catalog.baseline.version]:catalog.baseline.sha256},catalog)).toThrow('Mixed');
 expect(()=>verifySchemaLedger({...applied,[catalog.current[0].version]:catalog.current[0].sha256},catalog)).toThrow('Mixed');
 expect(()=>verifySchemaLedger({'clean-v3.sql':'0'.repeat(64)},catalog)).toThrow('changed');
 expect(()=>verifySchemaLedger(applied,prefix)).toThrow('coverage');
 const manifest=JSON.parse(readFileSync('db/current/effective-manifest.json','utf8'));expect(manifest.covered).toEqual(effective.covered);
});
