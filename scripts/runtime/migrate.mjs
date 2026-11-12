import{randomUUID}from'node:crypto';import{runtimeContext,readDeployment}from'./environment.mjs';import{createNativeBackup}from'../storage/backup.mjs';
import{loadSchemaCatalog,schemaMigrationPlan,migrationTransaction,verifySchemaLedger}from'../../src/local-app/schemaMigrations.ts';
import{keychainState}from'./keychain.mjs';
const options=process.argv.slice(2);if(options.some(a=>a!=='--no-backup'))throw Error('Only --no-backup is supported');const skipBackup=options.includes('--no-backup');
keychainState('unlock');const d=readDeployment(),c=runtimeContext(),versions=JSON.parse(c.sql("SELECT coalesce(jsonb_object_agg(version,sha256),'{}') FROM local_identity.schema_migrations")),catalog=loadSchemaCatalog(d.projectRoot);
// A normal start never crosses generations or adopts a new daily baseline implicitly.
const generation=verifySchemaLedger(versions,catalog),pending=schemaMigrationPlan(versions,catalog);
if(pending.length){if(!skipBackup&&d.automaticBackups!==false)await createNativeBackup({projectRoot:d.projectRoot,database:c.database,mediaRoot:d.mediaRoot,backupRoot:d.backupRoot,jobId:randomUUID()},undefined,c);c.sql(migrationTransaction(pending));}
console.log(JSON.stringify({passed:true,generation,applied:pending.map(f=>f.version),database:c.database,oldMigrationsUnchanged:true,baselineAdoptionDeferred:generation==='legacy-v1',backupSkippedByExplicitOption:skipBackup,backupDisabledByOwner:d.automaticBackups===false}));
