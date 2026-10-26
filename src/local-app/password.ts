import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
export interface PasswordDigest {salt:string;digest:string;version:'scrypt-v1'}
function derive(password:string,salt:string):Promise<Buffer>{return new Promise((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));}
export async function hashPassword(password:string):Promise<PasswordDigest>{
 if(password.length<12||password.length>1024)throw Error('密码须为12至1024字符。');
 const salt=randomBytes(32).toString('hex');return {version:'scrypt-v1',salt,digest:(await derive(password,salt)).toString('hex')};
}
export async function verifyPassword(password:string,record:PasswordDigest):Promise<boolean>{
 if(password.length>1024||record.version!=='scrypt-v1'||!/^[0-9a-f]{64}$/.test(record.salt)||!/^[0-9a-f]{128}$/.test(record.digest))return false;
 return timingSafeEqual(await derive(password,record.salt),Buffer.from(record.digest,'hex'));
}
