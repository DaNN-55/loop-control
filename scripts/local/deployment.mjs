import{existsSync,readFileSync,realpathSync}from'node:fs';
import{join,dirname,isAbsolute}from'node:path';
import{root,projectRoot,configuration,appPort,databasePort}from'./environment.mjs';
import{assertPrivatePath}from'../isolation/environment.mjs';
export function deploymentFile(args=process.argv.slice(2)){const index=args.indexOf('--deployment');if(index<0)return process.env.LOOP_LOCAL_DEPLOYMENT;const file=args[index+1];if(!file||!isAbsolute(file))throw Error('Deployment requires an absolute private file path');return file;}
function capabilities(c){
 const connections=c.connections;
 if(connections){
  if(Object.keys(connections).some(k=>!['keychain','verification'].includes(k))||!['disabled','pexels-offline',undefined].includes(connections.verification))throw Error('Online connection policy is not approved');
  const k=connections.keychain;
  if(k&&(Object.keys(k).some(p=>!['approved','runtimeRoot','helperSha256'].includes(p))||typeof k.approved!=='boolean'||k.runtimeRoot!==root||!/^[0-9a-f]{64}$/.test(k.helperSha256)))throw Error('Unapproved dedicated Keychain configuration');
 }
 const o=c.openChatCut;
 if(o&&(Object.keys(o).some(k=>!['root','node','port'].includes(k))||o.port!==55190||o.root!==join(projectRoot,'.loop-control/stage-b/verified/OpenChatCut')||realpathSync(o.root)!==o.root||o.node!==realpathSync(process.execPath)))throw Error('Unapproved isolated Studio runtime');
 return{...(connections?{connections}:{}),...(o?{openChatCut:o}:{})};
}
function databaseBinding(c,database){
 for(const [key,user]of[['database','loop_app'],['workerDatabase','loop_worker']]){
  const d=c[key];if(key==='workerDatabase'&&!c.worker&&!d)continue;
  if(!d||d.database!==database||d.user!==user||d.host!=='127.0.0.1'||d.port!==databasePort||typeof d.password!=='string'||!d.password||Object.keys(d).some(k=>!['host','port','user','database','password'].includes(k)))throw Error('Isolated native database binding mismatch');
 }
}
export function readDeployment(file=deploymentFile()){
 if(!file){
  const c=configuration(),workerFile=join(root,'native-worker.json'),worker=existsSync(workerFile)?JSON.parse(readFileSync(workerFile)):undefined,workerDatabase=worker?JSON.parse(readFileSync(join(root,'worker-database.json'))):undefined;
  if(worker)databaseBinding({database:c.database,worker,workerDatabase},c.database.database);
  return{projectRoot,port:appPort,database:c.database,mediaRoot:join(root,'media'),stateDirectory:join(root,'state/orchestration'),recordPath:join(root,'state/app.json'),logPath:join(root,'logs/app.log'),home:join(root,'home'),worker,workerDatabase,controlledNotifications:false,...capabilities(c)};
 }
 if(!isAbsolute(file)||realpathSync(file)!==file||!/^t(?:24|25)-[a-z0-9-]+$/.test(dirname(file).slice(join(root,'state').length+1))||dirname(dirname(file))!==join(root,'state'))throw Error('Unapproved isolated deployment file');
 assertPrivatePath(file);const c=JSON.parse(readFileSync(file)),base=dirname(file),restored=c.database?.database;
 if(c.projectRoot!==projectRoot||c.port!==55189)throw Error('Isolated native deployment identity mismatch');
 if(restored!=='loop_t25'){
  if(!/^loop_t24_restore[a-z0-9_]*$/.test(restored??'')||restored.length>60)throw Error('Unapproved restore database');
  const receiptFile=join(dirname(c.mediaRoot??''),'restore-receipt.json');assertPrivatePath(receiptFile);const r=JSON.parse(readFileSync(receiptFile));
  if(r.passed!==true||r.publicationFence!==true||r.connectionQualificationsCleared!==true||r.database!==restored||r.mediaRoot!==c.mediaRoot)throw Error('Restore deployment receipt mismatch');
 }
 databaseBinding(c,restored);
 for(const k of ['mediaRoot','stateDirectory','home'])if(typeof c[k]!=='string'||!c[k].startsWith(base+'/')||realpathSync(c[k])!==c[k])throw Error('Isolated native path mismatch');
 return{...c,...capabilities(c),projectRoot,recordPath:join(base,'app.json'),logPath:join(base,'app-private.log'),deploymentFile:file,controlledNotifications:true};
}
