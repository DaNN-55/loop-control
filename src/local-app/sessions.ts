import {createHash,createHmac,randomBytes} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {Pool} from 'pg';
import {verifyPassword,type PasswordDigest} from './password.js';
export const sessionCookie='loop_owner_session';
const lifetimeSeconds=12*60*60;
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export const csrfFor=(token:string)=>createHmac('sha256',token).update('loop-csrf-v1').digest('hex');
export interface OwnerSession {id:string;email:string;token:string}
export function readSessionToken(request:IncomingMessage):string|null{
 const matches=(request.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(sessionCookie+'='));
 if(matches.length!==1)return null;const token=matches[0].slice(sessionCookie.length+1);return /^[0-9a-f]{64}$/.test(token)?token:null;
}
export const cookieHeader=(token:string)=>`${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?lifetimeSeconds:0}`;
export async function lookupSession(pool:Pool,token:string|null):Promise<OwnerSession|null>{
 if(!token)return null;
 const {rows:[row]}=await pool.query(`SELECT o.id,o.email FROM local_identity.sessions s JOIN local_identity.owners o ON o.id=s.owner_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,[tokenHash(token)]);
 return row?{...row,token}:null;
}
export async function establishSession(pool:Pool,email:string,password:string,previousToken:string|null){
 const client=await pool.connect();
 try{
  // Serialize failures for this credential, preventing concurrent guesses from
  // losing attempts. The scrypt check holds only this Owner's short auth lock.
  await client.query('BEGIN');
  const {rows}=await client.query<{id:string;password_digest:PasswordDigest;locked:boolean}>(`SELECT o.id,c.password_digest,coalesce(c.locked_until>now(),false) locked FROM local_identity.credentials c JOIN local_identity.owners o ON o.id=c.owner_id WHERE lower(o.email)=lower($1) FOR UPDATE OF c`,[email]);
  const row=rows.length===1?rows[0]:undefined;
  const accepted=row&&!row.locked&&await verifyPassword(password,row.password_digest);
  if(!accepted){
   if(row&&!row.locked)await client.query(`UPDATE local_identity.credentials SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '15 minutes' END WHERE owner_id=$1`,[row.id]);
   await client.query('COMMIT');return null;
  }
  await client.query('UPDATE local_identity.credentials SET failed_attempts=0,locked_until=NULL WHERE owner_id=$1',[row.id]);
  if(previousToken)await client.query('UPDATE local_identity.sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash(previousToken)]);
  const token=randomBytes(32).toString('hex');
  await client.query(`INSERT INTO local_identity.sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '12 hours')`,[tokenHash(token),row.id]);
  await client.query('COMMIT');return token;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function revokeSession(pool:Pool,token:string){await pool.query('UPDATE local_identity.sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash(token)]);}
