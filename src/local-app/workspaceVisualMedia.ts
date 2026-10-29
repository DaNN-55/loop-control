import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {ConfigurationError} from './configurationCommands.js';
export async function inspectWorkspaceVisualFile(root:string,path:string,kind:'video'|'image'){
 try{const {stdout}=await promisify(execFile)('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_type,width,height,duration:format=duration','-of','json',join(root,path)],{timeout:15000});const p=JSON.parse(stdout),s=p.streams?.[0],width=Number(s?.width),height=Number(s?.height),durationSeconds=Number(s?.duration??p.format?.duration);
 if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||kind==='video'&&(!Number.isFinite(durationSeconds)||durationSeconds<=0))throw Error();return{width,height,durationSeconds:kind==='video'?durationSeconds:null};
 }catch{throw new ConfigurationError(409,'视觉素材无法读取，请检查原始文件。');}
}
