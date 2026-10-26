import{execFileSync}from'node:child_process';
import{readFileSync,lstatSync,realpathSync,mkdirSync,writeFileSync,existsSync}from'node:fs';
import{fileURLToPath}from'node:url';import{join,relative,isAbsolute,dirname,resolve}from'node:path';
export const projectRoot=realpathSync(fileURLToPath(new URL('../../',import.meta.url))),root=join(projectRoot,'.loop-control/local');
export function assertPrivatePath(path){const rel=relative(root,resolve(path));if(rel.startsWith('..')||isAbsolute(rel))throw Error('Runtime path leaves local directory');let p=resolve(path);while(p!==projectRoot){if(existsSync(p)){const s=lstatSync(p);if(s.isSymbolicLink()||s.uid!==process.getuid?.()||p!==dirname(root)&&(s.mode&0o077)!==0)throw Error('Runtime path must be private and owned');}p=dirname(p);}}
export function ensurePrivateDirectory(path){assertPrivatePath(path);mkdirSync(path,{recursive:true,mode:0o700});assertPrivatePath(path);}
export function writePrivateFile(path,value,{exclusive=false}={}){ensurePrivateDirectory(dirname(path));writeFileSync(path,value,{mode:0o600,...(exclusive?{flag:'wx'}:{})});}
export const deploymentFile=()=>join(root,'deployment.json');
export function validateSettings(d){if(d.version!==1||d.purpose!=='local-daily'||d.projectRoot!==projectRoot||d.runtimeRoot!==root||d.postgres?.profile!=='loop-control'||d.postgres.container!=='loop-control-local-postgres'||d.postgres.volume!=='loop-control-local-data'||d.postgres.image!=='sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929')throw Error('Daily runtime identity mismatch');return d;}
export function readSettings(){const path=deploymentFile();assertPrivatePath(path);return validateSettings(JSON.parse(readFileSync(path)));}
export function runtimeContext(){const d=readSettings(),container=d.postgres.container,env={PATH:process.env.PATH,HOME:process.env.HOME,DOCKER_HOST:'unix://'+join(process.env.HOME,'.colima/loop-control/docker.sock')};
 const docker=(args,input)=>execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});
 const assertDatabase=()=>{const c=JSON.parse(docker(['inspect',container]))[0];if(c.Config.Image!==d.postgres.image||c.Config.Labels?.['com.loop-control.project']!==projectRoot||c.Config.Labels?.['com.loop-control.runtime']!=='local-daily')throw Error('Daily PostgreSQL container identity mismatch');};
 const sql=(text,database=d.database.database)=>{assertDatabase();if(!/^[a-z_][a-z0-9_]*$/.test(database))throw Error('Invalid database');return docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],text).trim();};
 return{dailyRuntime:true,projectRoot,root,container,env,docker,sql,assertDatabase,ensurePrivateDirectory,database:d.database.database,mediaRoot:d.mediaRoot};
}
export function validateDeployment(d){validateSettings(d);if(!Number.isInteger(d.port)||d.port<1024||d.port>65535)throw Error('Invalid app port');
 for(const[key,user]of[['database','loop_app'],['workerDatabase','loop_worker']]){const c=d[key];if(c?.host!=='127.0.0.1'||c.port!==54329||c.database!=='loop_control'||c.user!==user||typeof c.password!=='string'||!c.password||Object.keys(c).some(k=>!['host','port','database','user','password'].includes(k)))throw Error('Daily database binding mismatch');}
 if(d.mediaRoot!==join(root,'volume/media')||d.worker.mountPath!==join(root,'volume')||d.backupRoot!==join(root,'backups/loop_control')||d.openChatCut.root!==join(root,'OpenChatCut')||d.openChatCut.port!==5175||d.connections?.keychain?.runtimeRoot!==root)throw Error('Daily capabilities mismatch');
return d;}
export function readDeployment(){const d=validateDeployment(readSettings());
 for(const p of[d.mediaRoot,d.stateDirectory,d.backupRoot,d.openChatCut?.root,d.worker?.mountPath,d.worker?.alignment?.cacheDirectory]){if(typeof p!=='string')throw Error('Missing runtime path');assertPrivatePath(p);if(realpathSync(p)!==p)throw Error('Noncanonical runtime path');}
 const receipt=JSON.parse(readFileSync(join(root,'volume/restore-receipt.json')));if(receipt.passed!==true||receipt.database!==d.database.database||receipt.mediaRoot!==d.mediaRoot||receipt.publicationFence!==true)throw Error('Daily database/media restore not verified');
 return{...d,deploymentFile:deploymentFile(),recordPath:join(root,'app.json'),logPath:join(root,'app-private.log'),backupScript:join(projectRoot,'scripts/runtime/backup.mjs'),backupEnvironment:{LOOP_DAILY_RUNTIME:'1'},controlledNotifications:d.notifications!=='desktop'};
}
