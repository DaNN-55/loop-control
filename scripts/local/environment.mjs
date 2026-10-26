import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {projectRoot,toolEnvironment,ensurePrivateDirectory,writePrivateFile,assertPrivatePath} from '../isolation/environment.mjs';
import {readFileSync} from 'node:fs';
export {projectRoot,writePrivateFile,ensurePrivateDirectory};
export const root=join(projectRoot,'.loop-control/stage-d');
export const container='loop-control-stage-d-postgres';
export const label='loop-control-stage-d-native';
export const databasePort=55472,appPort=55177;
export const env={...toolEnvironment(),DOCKER_HOST:'unix:///Users/dan/.colima/loop-stage-a/docker.sock'};
export function docker(args,input){return execFileSync('docker',args,{env,input,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});}
export function assertDatabase(){const c=JSON.parse(docker(['inspect',container]))[0];if(c?.Config?.Labels?.['com.loop-control.isolation']!==label || c.Config.Image!=='postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929')throw Error('Native test database identity mismatch');}
export function sql(text,database='loop_imported'){assertDatabase();return docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],text).trim();}
export function configuration(){const path=join(root,'config.json');assertPrivatePath(path);const c=JSON.parse(readFileSync(path,'utf8'));if(c.projectRoot!==projectRoot||c.port!==appPort||c.database.host!=='127.0.0.1'||c.database.port!==databasePort||c.database.database!=='loop_imported'||c.database.user!=='loop_app'||Object.keys(c.database).some(k=>!['host','port','database','user','password'].includes(k)))throw Error('Native app configuration mismatch');return c;}
export function verifiedSource(){
 const base=join(projectRoot,'.loop-control/stage-b/verified');const path=join(base,'config.json');assertPrivatePath(path);const c=JSON.parse(readFileSync(path,'utf8'));
 if(c.projectRoot!==projectRoot||c.projectId!=='loop-control-stage-b-verified'||c.apiUrl!=='http://127.0.0.1:55461'||c.runtimeRoot!==base)throw Error('Verified bridge identity mismatch');
 return c;
}
