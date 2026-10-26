// Publish a selectable normal deployment from a verified isolated restore receipt.
// Credentials stay in private files in the approved stage-d namespace.
import{readFileSync,existsSync,realpathSync}from'node:fs';
import{dirname,join,isAbsolute}from'node:path';
import{root,projectRoot,ensurePrivateDirectory,writePrivateFile}from'./environment.mjs';
import{assertPrivatePath}from'../isolation/environment.mjs';
import{readDeployment}from'./deployment.mjs';
export function writeRestoredDeployment({sourceFile,receiptFile,outputFile,mountPath}){
 for(const p of[sourceFile,receiptFile,outputFile,mountPath])if(typeof p!=='string'||!isAbsolute(p))throw Error('Pass absolute private restore deployment paths');
 const source=readDeployment(sourceFile);assertPrivatePath(receiptFile);const receipt=JSON.parse(readFileSync(receiptFile));const base=dirname(outputFile);
 if(existsSync(outputFile)||dirname(base)!==join(root,'state')||!/^t24-[a-z0-9-]+$/.test(base.slice(join(root,'state').length+1))||!receipt.mediaRoot?.startsWith(base+'/')||receiptFile!==join(dirname(receipt.mediaRoot),'restore-receipt.json')||!mountPath.startsWith(base+'/')||!receipt.mediaRoot.startsWith(mountPath+'/')||realpathSync(mountPath)!==mountPath)throw Error('Unapproved restore deployment destination');
 for(const name of['home','orchestration'])ensurePrivateDirectory(join(base,name));
 const {worker,connections,openChatCut}=source;
 const result={projectRoot,port:55189,database:{...source.database,database:receipt.database},...(worker?{worker:{...worker,mountPath},workerDatabase:{...source.workerDatabase,database:receipt.database}}:{}),mediaRoot:receipt.mediaRoot,home:join(base,'home'),stateDirectory:join(base,'orchestration'),...(connections?{connections}:{}),...(openChatCut?{openChatCut}:{})};
 // readDeployment validates the same receipt and bindings on every normal start.
 writePrivateFile(outputFile,JSON.stringify(result,null,2)+'\n',{exclusive:true});
 try{readDeployment(outputFile);}catch{throw Error('Restore deployment rejected; private file retained for diagnosis');}
 return{deploymentFile:outputFile,database:receipt.database,requiresOwnerPasswordBootstrap:true,requiresSecretRebind:true,onlineQualificationGranted:false};
}
if(process.argv[1]===new URL(import.meta.url).pathname){let raw='';for await(const b of process.stdin){raw+=b;if(raw.length>8192)throw Error('Input too large');}console.log(JSON.stringify(writeRestoredDeployment(JSON.parse(raw))));}
