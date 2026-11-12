import{execFileSync}from'node:child_process';
const container='loop-live-acceptance-20261112';
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,DOCKER_HOST:'unix:///Users/dan/.colima/loop-control/docker.sock'};
const call=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
export function runtimeContext(){
 const assertDatabase=()=>{const c=JSON.parse(call(['inspect',container]))[0];if(c.Config.Labels?.['com.loop-control.test']!=='live-production-20261112'||!c.Mounts.some(m=>m.Name===container+'-data'))throw Error('Acceptance database identity mismatch');};
 const docker=(args,input)=>{assertDatabase();if(args[0]!=='exec'||!args.includes(container))throw Error('Fixture only operates its acceptance container');return call(args,input);};
 const sql=(q,db='loop_live_acceptance')=>{if(db==='postgres'&&!/^(CREATE DATABASE loop_[a-z0-9_]+ TEMPLATE template0|DROP DATABASE loop_[a-z0-9_]+ WITH\s*\(FORCE\)|SELECT count\(\*\) FROM pg_database WHERE datname='loop_[a-z0-9_]+')\s*;?$/i.test(q.trim()))throw Error('Only fixture databases may be changed');if(db!=='postgres'&&db!=='loop_live_acceptance'&&!/^loop_[a-z0-9_]+_[a-f0-9]{12}(?:_[a-z]+)?$/.test(db))throw Error('Fixture database name required');return docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],q).trim();};
 return{container,database:'loop_live_acceptance',env,docker,sql,assertDatabase,dailyRuntime:false};
}
