// Forward adaptation of the frozen C business schema. Historical Supabase migrations
// is retained in db/local/c-baseline.sql; current local databases have no Auth/Vault schema.
import {createHash} from 'node:crypto';
export function adaptBusinessSchema(source) {
 const dependencies={identityForeignKeys:(source.match(/REFERENCES auth\.users\(id\)/g)??[]).length,ownerCalls:(source.match(/auth\.uid\(\)/g)??[]).length,vaultDisabled:[]};
 let sql=source.replace(/^\\(?:un)?restrict .*\n/gm,'').replace('CREATE SCHEMA public;','CREATE SCHEMA IF NOT EXISTS public;');
 sql=sql.replace(/CREATE FUNCTION ([\s\S]*?)\n\s+AS (\$[^$]*\$)([\s\S]*?)\2;/g,(whole,signature,delimiter,body)=>{
  if(!/\bvault\./.test(body))return whole;
  if(!/LANGUAGE plpgsql/.test(signature))throw Error('Unknown Vault function language');
  dependencies.vaultDisabled.push(signature.split('\n')[0]);
  return `CREATE FUNCTION ${signature}\n    AS ${delimiter}begin raise exception 'local connection secrets are not migrated' using errcode='0A000'; end;${delimiter};`;
 });
 sql=sql.replaceAll('auth.users','local_identity.owners').replaceAll('auth.uid()','local_identity.owner_id()').replaceAll('auth.role()','local_identity.actor_role()').replaceAll("current_setting('request.jwt.claim.role', true)",'local_identity.actor_role()');
 sql=sql.replace(/\bTO authenticated\b/g,'TO loop_owner').replace(/\bTO anon\b/g,'TO loop_anonymous').replace(/\bTO service_role\b/g,'TO loop_worker');
 if(/\bauth\.|\bvault\./.test(sql))throw Error('Unadapted platform dependency');
 return {sql,dependencies,sourceSha256:createHash('sha256').update(source).digest('hex')};
}
