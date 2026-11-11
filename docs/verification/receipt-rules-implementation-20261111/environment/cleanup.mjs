// Only removes the exact task container after fixtures have released their databases.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {runtimeContext} from './runtime-context.mjs';

const run=JSON.parse(await readFile(new URL('./run.json',import.meta.url),'utf8'));
const context=runtimeContext();
context.assertDatabase();
if(context.container!==run.container||run.label!=='receipt-'+run.runId)throw Error('Run identity mismatch');
const pending=context.docker(['exec',context.container,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],"SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1','loop_receipt_baseline');").trim();
const clients=context.sql('SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type=\'client backend\'');
if(pending||clients!=='0')throw Error('Fixtures still active; databases='+pending+'; clients='+clients);
console.log(JSON.stringify({container:context.container,identity:'verified',fixtureDatabases:0,otherClients:0,action:process.argv.includes('--stop')?'stop':'check only'}));
if(process.argv.includes('--stop')){
 context.assertDatabase();
 execFileSync('docker',['stop','--timeout','5',context.container],{env:context.env,stdio:'inherit'});
}
