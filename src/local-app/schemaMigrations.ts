// ADR-0047: one immutable catalog for maintenance, restore and fixture schema ledgers.
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export interface SchemaMigration {version:string;body:string;sha256:string}
export interface SchemaCatalog {legacy:SchemaMigration[];current:SchemaMigration[];baseline:SchemaMigration;upgrade:SchemaMigration;effective?:{baseline:SchemaMigration;covered:Record<string,string>}}
const numbered=/^[0-9]{3}-[a-z0-9-]+\.sql$/;
const digest=(body:string)=>createHash('sha256').update(body).digest('hex');
export function loadSchemaCatalog(projectRoot:string):SchemaCatalog {
 const archive=join(projectRoot,'db/archive/legacy-v1'),current=join(projectRoot,'db/current');
 const manifest=JSON.parse(readFileSync(join(archive,'manifest.json'),'utf8')) as {generation:string;files:Record<string,string>};
 if(manifest.generation!=='legacy-v1')throw Error('Unknown historical schema generation');
 const read=(root:string,version:string,expected?:string):SchemaMigration=>{if(!/^[a-z0-9][a-z0-9.-]*\.sql$/.test(version))throw Error('Invalid schema catalog filename');const body=readFileSync(join(root,version),'utf8'),sha256=digest(body);if(expected!==undefined&&sha256!==expected)throw Error('Archived migration changed: '+version);return{version,body,sha256};};
 const legacy=Object.entries(manifest.files).map(([version,sha256])=>read(archive,version,sha256)).filter(file=>numbered.test(file.version)).sort((a,b)=>a.version.localeCompare(b.version));
 const generation=JSON.parse(readFileSync(join(current,'manifest.json'),'utf8')) as {generation:string;baselineSha256:string;upgradeSha256:string;legacyManifestSha256:string};
 if(generation.generation!=='clean-v2'||generation.legacyManifestSha256!==digest(readFileSync(join(archive,'manifest.json'),'utf8')))throw Error('Schema generation mapping changed');
 const baseline={...read(current,'baseline.sql',generation.baselineSha256),version:'clean-v2.sql'},upgrade=read(current,'upgrade-from-legacy-v1.sql',generation.upgradeSha256);
 const forwards=readdirSync(current).filter(n=>numbered.test(n)).sort().map(n=>read(current,n));
 const effectiveManifest=JSON.parse(readFileSync(join(current,'effective-manifest.json'),'utf8')) as {generation:string;baselineSha256:string;covered:Record<string,string>};
 const sources=new Map([baseline,...forwards].map(f=>[f.version,f.sha256]));
 if(effectiveManifest.generation!=='clean-v3'||effectiveManifest.covered[baseline.version]!==baseline.sha256||Object.entries(effectiveManifest.covered).some(([v,sha])=>sources.get(v)!==sha))throw Error('Effective schema coverage changed');
 const covered=forwards.filter(f=>Object.hasOwn(effectiveManifest.covered,f.version));
 if(covered.some((f,i)=>f.version!==forwards[i]?.version))throw Error('Effective schema coverage is not a prefix');
 const effective={baseline:{...read(current,'effective-baseline.sql',effectiveManifest.baselineSha256),version:'clean-v3.sql'},covered:effectiveManifest.covered};
 return{legacy,current:forwards,baseline,upgrade,effective};
}
function hasEffectiveCoverage(catalog:SchemaCatalog):boolean {
 const sources=new Map([catalog.baseline,...catalog.current].map(f=>[f.version,f.sha256]));
 return Boolean(catalog.effective&&Object.entries(catalog.effective.covered).every(([v,sha])=>sources.get(v)===sha));
}
export function verifySchemaLedger(applied:Record<string,string>,catalog:SchemaCatalog):'legacy-v1'|'clean-v2'|'clean-v3' {
 const known=new Map([...catalog.legacy,catalog.baseline,...catalog.current,...(catalog.effective?[catalog.effective.baseline]:[])].map(file=>[file.version,file.sha256]));
 for(const[version,sha256]of Object.entries(applied))if(known.get(version)!==sha256)throw Error('Applied migration changed or unknown: '+version);
 if(catalog.effective&&Object.hasOwn(applied,catalog.effective.baseline.version)){
  if(!hasEffectiveCoverage(catalog))throw Error('Incomplete effective schema coverage');
  if([...catalog.legacy.map(f=>f.version),...Object.keys(catalog.effective.covered)].some(v=>Object.hasOwn(applied,v)))throw Error('Mixed schema generation ledger');
  const forwards=catalog.current.filter(f=>!Object.hasOwn(catalog.effective!.covered,f.version));
  const current=forwards.filter(f=>Object.hasOwn(applied,f.version));
  if(current.some((f,i)=>f.version!==forwards[i]?.version))throw Error('Incomplete current migration ledger');
  return 'clean-v3';
 }
 const clean=Object.hasOwn(applied,catalog.baseline.version);
 // A legacy ledger must be a prefix, never silently replay a hole in historical migrations.
 const existing=catalog.legacy.filter(file=>Object.hasOwn(applied,file.version));
 if(existing.some((file,i)=>file.version!==catalog.legacy[i]?.version)||(!clean&&catalog.current.some(f=>Object.hasOwn(applied,f.version))))throw Error('Incomplete schema generation mapping');
 if(clean&&existing.length!==0&&existing.length!==catalog.legacy.length)throw Error('Incomplete historical ledger after baseline transition');
 const current=catalog.current.filter(file=>Object.hasOwn(applied,file.version));
 if(current.some((file,i)=>file.version!==catalog.current[i]?.version))throw Error('Incomplete current migration ledger');
 return clean?'clean-v2':'legacy-v1';
}
export function schemaMigrationPlan(applied:Record<string,string>,catalog:SchemaCatalog,allowBaselineUpgrade=false):SchemaMigration[] {
 const generation=verifySchemaLedger(applied,catalog);
 if(generation==='clean-v3')return catalog.current.filter(f=>!Object.hasOwn(catalog.effective!.covered,f.version)&&!Object.hasOwn(applied,f.version));
 if(generation==='clean-v2')return catalog.current.filter(f=>!Object.hasOwn(applied,f.version));
 const pending=catalog.legacy.filter(f=>!Object.hasOwn(applied,f.version));
 if(allowBaselineUpgrade)pending.push({...catalog.upgrade,version:catalog.baseline.version,sha256:catalog.baseline.sha256},...catalog.current);
 return pending;
}
export function migrationTransaction(migrations:SchemaMigration[]):string {
 return 'BEGIN;\n'+migrations.map(f=>`${f.body}\nINSERT INTO local_identity.schema_migrations(version,sha256) VALUES('${f.version}','${f.sha256}');`).join('\n')+'\nCOMMIT;';
}
export function freshSchemaTransaction(catalog:SchemaCatalog):string {
 if(hasEffectiveCoverage(catalog))return migrationTransaction([catalog.effective!.baseline,...catalog.current.filter(f=>!Object.hasOwn(catalog.effective!.covered,f.version))]);
 return migrationTransaction([catalog.baseline,...catalog.current]);
}

/** Fixed, lossless historical table aliases used only after current restore migrations. */
export function restoredSchemaTable(table:string):string {
 return ({'local_identity.storyboard_planning_defaults':'local_identity.historical_planning_defaults','local_identity.storyboard_planning_harnesses':'local_identity.historical_planning_harnesses'} as Record<string,string>)[table]??table;
}
