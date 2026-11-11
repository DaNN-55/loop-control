import {constants,lstatSync,realpathSync,accessSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

function directory(path){
 if(typeof path!=='string'||path.length>4096||/[\x00-\x1f\x7f]/.test(path)||!isAbsolute(path))throw Error('请填写有效的绝对目录路径。');
 const full=resolve(path),stat=lstatSync(full);
 if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(full)!==full||stat.uid!==process.getuid?.())throw Error('请选择当前用户拥有的本机普通目录。');
 accessSync(full,constants.R_OK|constants.W_OK|constants.X_OK);return full;
}
function logFile(root,path){return join(path,path===root?'app-private.log':'loop-control-runtime.log');}
function validateFile(path){try{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error('目标日志文件不安全，请选择其他目录。');}catch(error){if(error.code!=='ENOENT')throw error;}}
function configured(root){
 try{const file=join(root,'log-storage.json'),s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)!==0||s.size>8192)throw Error();const value=JSON.parse(readFileSync(file,'utf8'));if(value.version!==1||typeof value.directory!=='string'||Object.keys(value).some(k=>!['version','directory'].includes(k)))throw Error();return value.directory;}
 catch(error){if(error.code==='ENOENT')return root;throw Error('日志位置设置不可读，请在个人偏好中重新保存。');}
}
export function runtimeLogBinding(root){
 let requested=root;
 try{requested=configured(root);const path=directory(requested),file=logFile(root,path);validateFile(file);return{directory:path,file,configuredDirectory:path,fallbackReason:null};}
 catch{return{directory:root,file:join(root,'app-private.log'),configuredDirectory:requested,fallbackReason:'自定义日志位置不可用，当前使用默认位置。'};}
}
export function createLogStorage(root,activeFile){
 const read=()=>{const binding=runtimeLogBinding(root);return{activeDirectory:resolve(activeFile,'..'),configuredDirectory:binding.configuredDirectory,defaultDirectory:root,pending:binding.file!==activeFile,warning:binding.fallbackReason};};
 const save=path=>{
  const target=directory(path),file=logFile(root,target);validateFile(file);
  const temporary=join(root,'.log-storage-'+randomUUID()+'.tmp');
  try{writeFileSync(temporary,JSON.stringify({version:1,directory:target})+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,join(root,'log-storage.json'));}finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
  return read();
 };
 return{read,save};
}
