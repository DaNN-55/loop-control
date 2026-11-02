// Local audit coordinator. Context and commands contain only synthetic test identities.
import{readFile,writeFile,rename}from'node:fs/promises';
import{join}from'node:path';
import{randomUUID}from'node:crypto';
const [contextFile,action,dataJson='{}',format]=process.argv.slice(2);
if(!contextFile||!action)throw Error('Usage: node control.mjs <audit-context.json> <action> [JSON]');
const context=JSON.parse(await readFile(contextFile,'utf8'));
if(!context.control.startsWith('/private/tmp/loop-ui-audit-')&&!context.control.startsWith('/private/tmp/loop-story-e2e-'))throw Error('Audit context outside owned temporary snapshot');
const id=Date.now()+'-'+randomUUID(),file=join(context.control,id+'.request.json');
await writeFile(file+'.tmp',JSON.stringify({action,data:JSON.parse(dataJson)}),{mode:0o600});await rename(file+'.tmp',file);
const timeout=Date.now()+180000;
for(;;){
 try{const result=JSON.parse(await readFile(join(context.control,id+'.response.json'),'utf8'));if(!result.ok){process.stderr.write(result.error+'\n');process.exitCode=1;}else{let value=result.value;if(action==='browser'&&value?.snapshot)value={snapshot:value.snapshot};else if(action==='browser'&&Object.hasOwn(value??{},'result'))value={result:value.result};if(format==='summary'){const body=value?.body??value;value={status:value?.status,error:body?.error,id:body?.id,revision:body?.revision,clipCount:body?.clips?.length,lastClip:body?.clips?.at(-1),historyCount:body?.history?.length,visualTasks:body?.visualTasks,nativeEditRevision:body?.nativeEditRevision};}process.stdout.write(JSON.stringify(value,null,2)+'\n');}break;}
 catch(error){if(error.code!=='ENOENT')throw error;if(Date.now()>timeout)throw Error('Audit control timed out: '+action);await new Promise(resolve=>setTimeout(resolve,150));}
}
