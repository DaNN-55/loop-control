import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {adaptBusinessSchema,businessCopies,recordFingerprint} from './import.mjs';
import {root,projectRoot,container,docker,sql,ensurePrivateDirectory,writePrivateFile} from './environment.mjs';
import {readBackup,inventorySql,digest,quote} from '../isolation/backup.mjs';
import {targetConfiguration} from '../isolation/restore.mjs';
const source=targetConfiguration();
if(source.projectId!=='loop-control-stage-b-verified')throw Error('Use --verified source');
const backup=JSON.parse(readFileSync(join(projectRoot,'docs/verification/stage-c-t11/stage-c-backup.json')));
const manifest=readBackup(backup.root,source);
if(manifest.archiveSha256!==backup.archiveSha256)throw Error('C backup pointer mismatch');
const archive=readFileSync(join(backup.root,'business.dump'));
const exported=docker(['exec','-i',container,'pg_restore','--schema-only','--no-owner','--no-privileges','--file=-'],archive).replace(/^\\(?:un)?restrict .*\n/gm,'');
const baseline=readFileSync(join(projectRoot,'db/local/c-baseline.sql'),'utf8');
if(exported!==baseline)throw Error('Frozen baseline does not match selected backup');
const adapted=adaptBusinessSchema(baseline);
const identity=readFileSync(join(projectRoot,'db/local/identity.sql'),'utf8');
const access=readFileSync(join(projectRoot,'db/local/read-access.sql'),'utf8');
ensurePrivateDirectory(join(root,'state'));
const verifyExisting=process.argv.includes('--verify-existing');
for(const database of (verifyExisting?['loop_imported']:['loop_empty','loop_imported'])){
 const record=join(root,`state/${database}-import.json`);
 if(existsSync(record))throw Error('Recorded database retained; refusing to overwrite');
 if(!verifyExisting && sql(`select count(*) from pg_database where datname=${quote(database)}`,'postgres')!=='0')throw Error('Unrecorded target exists; inspect before retry');
 if(!verifyExisting){
 sql(`create database ${database} template template0`,'postgres');
 sql(`begin;${identity}\n${adapted.sql}\n${access}\ncommit;`,database);
 for(const owner of manifest.users)sql(`insert into local_identity.owners(id,email) values(${quote(owner.id)},${quote(owner.email)})`,database);
 const empty=JSON.parse(sql(inventorySql(),database));
 if(Object.values(empty).some(t=>t.count!==0))throw Error('New schema unexpectedly contains business rows');
 }
 let copyFingerprints,localeDigestDifferences;
 if(database==='loop_imported'){
  const data=docker(['exec','-i',container,'pg_restore','--data-only','--no-owner','--no-privileges','--file=-'],archive).replace(/^\\(?:un)?restrict .*\n/gm,'');
  if(!verifyExisting)sql(`begin;set session_replication_role=replica;\n${data}\nset session_replication_role=origin;commit;`,database);
  const inventory=JSON.parse(sql(inventorySql(),database));
  const copies=businessCopies(data);
  if(JSON.stringify(copies.map(x=>x.table).sort())!==JSON.stringify(Object.keys(manifest.inventory).sort()))throw Error('Archive COPY table coverage differs');
  copyFingerprints={};
  for(const copy of copies){
   const expected=recordFingerprint(copy.records);
   const actual=docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],`COPY public.${copy.table} (${copy.columns}) TO STDOUT;`);
   if(recordFingerprint(actual)!==expected || inventory[copy.table].count!==manifest.inventory[copy.table].count)throw Error(`Archive records differ: ${copy.table}`);
   copyFingerprints[copy.table]=expected;
  }
  localeDigestDifferences=Object.keys(inventory).filter(t=>inventory[t].md5!==manifest.inventory[t].md5);
  // Validate every foreign key explicitly: import suppresses triggers only inside
  // the isolated transaction, so no missing identity or historical reference hides.
  sql(`do $$ declare f record; bad boolean; begin for f in select c.conrelid::regclass child,c.confrelid::regclass parent,c.conkey,c.confkey from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='f' and n.nspname='public' loop
   execute format('select exists(select 1 from %s a where %s and not exists(select 1 from %s b where %s))',f.child,(select string_agg(format('a.%I is not null',attname),' and ' order by i) from unnest(f.conkey) with ordinality k(a,i) join pg_attribute on attrelid=f.child and attnum=k.a),f.parent,(select string_agg(format('a.%I=b.%I',x.attname,y.attname),' and ' order by k.i) from unnest(f.conkey,f.confkey) with ordinality k(a,b,i) join pg_attribute x on x.attrelid=f.child and x.attnum=k.a join pg_attribute y on y.attrelid=f.parent and y.attnum=k.b)) into bad;
   if bad then raise exception 'Orphaned FK on %',f.child; end if;
  end loop;end $$;`,database);
  sql(`insert into local_identity.import_record(imported_at,source_created_at,archive_sha256) values(now(),${quote(manifest.createdAt)},${quote(manifest.archiveSha256)})`,database);
 }
 const inventory=JSON.parse(sql(inventorySql(),database));
 const result={database,nativePostgres:true,sourceCreatedAt:manifest.createdAt,archiveSha256:manifest.archiveSha256,schemaSha256:digest(baseline),platformAdaptation:adapted.dependencies,tables:inventory,rows:Object.values(inventory).reduce((n,t)=>n+t.count,0),emptySchemaVerified:!verifyExisting || existsSync(join(root,'state/loop_empty-import.json')),copyFingerprints,localeDigestDifferences};
 writePrivateFile(record,JSON.stringify(result,null,2)+'\n',{exclusive:true});
 console.log(JSON.stringify({database,tables:Object.keys(inventory).length,rows:result.rows,emptySchemaVerified:true}));
}
