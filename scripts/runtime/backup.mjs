import{runtimeContext}from'./environment.mjs';import{createNativeBackup}from'../storage/backup.mjs';
let input='';for await(const b of process.stdin){input+=b;if(input.length>8192)throw Error('Input too large');}
try{console.log(JSON.stringify(await createNativeBackup(JSON.parse(input),undefined,runtimeContext())));}catch{console.error('Daily full backup failed; existing evidence retained.');process.exitCode=1;}
