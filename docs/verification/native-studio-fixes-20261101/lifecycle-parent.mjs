import {spawn} from 'node:child_process';import {openSync,writeFileSync} from 'node:fs';
const [mode,port,base,project,sdk]=process.argv.slice(2);const log=openSync(base+'/child.log','a',0o600);
const child=spawn(process.execPath,[project+'/scripts/openchatcut-embedded.mjs',port],{cwd:sdk,detached:mode==='detached',env:{PATH:process.env.PATH,HOME:process.env.HOME,OPENCHATCUT_ROOT:sdk,OPENCHATCUT_DATA_DIR:base+'/data',LOOP_OPENCHATCUT_VITE_CACHE_DIR:base+'/cache',OPENCHATCUT_DEV_PROFILE_ID:crypto.randomUUID(),OPENCHATCUT_DISABLE_HARDWARE_ENCODING:'1'},stdio:['ignore',log,log]});
writeFileSync(base+'/child.json',JSON.stringify({pid:child.pid,detached:mode==='detached'}),{mode:0o600});if(mode==='detached')child.unref();setInterval(()=>{},1000);
