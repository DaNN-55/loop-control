// Historical acceptance entry; everyday callers use the shared implementation directly.
import * as stageRuntime from './environment.mjs';
import{createNativeBackup as backup}from'../storage/backup.mjs';
export function createNativeBackup(input,afterSnapshot,runtime=stageRuntime){return backup(input,afterSnapshot,runtime);}
if(process.argv[1]===new URL(import.meta.url).pathname){try{let raw='';for await(const b of process.stdin){raw+=b;if(raw.length>8192)throw Error('Input too large');}console.log(JSON.stringify(await createNativeBackup(JSON.parse(raw))));}catch{console.error('Native backup failed; private partial evidence retained.');process.exitCode=1;}}
