import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {env,sql,assertContainer,sourceContainer,config} from './backup.mjs';
import {targetContainer,targetId} from './restore.mjs';
import {projectRoot} from './environment.mjs';
const baseline=process.argv.includes('--baseline');
const container=baseline?sourceContainer:targetContainer;
assertContainer(container,baseline?config.projectId:targetId);
if(!baseline)sql('create extension if not exists pgtap with schema extensions;',container);
const selected=process.argv.includes('--affected')?['local_whisperx_alignment_test.sql','worker_runtime_constraints_test.sql']:readdirSync(join(projectRoot,'supabase/tests')).filter(f=>f.endsWith('.sql')).sort();
const results=[];
for(const file of selected){
 const source=baseline?execFileSync('git',['show',`19f1607:supabase/tests/${file}`],{cwd:projectRoot,encoding:'utf8'}):readFileSync(join(projectRoot,'supabase/tests',file),'utf8');
 if(!/rollback;\s*$/i.test(source))throw new Error('SQL regression must roll back');
 const r=spawnSync('docker',['exec','-i',container,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','--set=VERBOSITY=sqlstate'],{env,input:(baseline?'begin;create extension if not exists pgtap with schema extensions;\n':'')+'set search_path=public,extensions;\n'+source,encoding:'utf8',maxBuffer:10*1024*1024});
 // TAP diagnostics can quote fixture secrets; record descriptions/results only.
 const lines=(r.stdout??'').split('\n');const checks=lines.filter(l=>/^(?:not )?ok \d+/.test(l));
 const failures=checks.filter(l=>l.startsWith('not ok'));
 const planProblem=lines.some(l=>/^# Looks like/.test(l));
 results.push({file,passed:r.status===0 && !failures.length && !planProblem,checks:checks.length,failures,sqlError:r.status!==0,sqlState:(r.stderr??'').match(/ERROR:\s+([A-Z0-9]{5})\b/)?.[1]??null,planProblem});
}
console.log(JSON.stringify({target:baseline?config.projectId:targetId,baseline:baseline?'19f1607':null,results,checks:results.reduce((n,r)=>n+r.checks,0)},null,2));if(results.some(r=>!r.passed))process.exitCode=1;
