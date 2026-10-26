// Forward adaptation of the frozen C business schema. Historical Supabase migrations
// remain intact; there are no compatibility Auth/Vault schemas in the local database.
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

// Compare the archive's actual COPY records, independent of host libc collation.
// The v2 manifest sorted jsonb text under the source's locale; its ordered md5
// cannot be used across different libc versions even when every row is identical.
export function businessCopies(data) {
 const copies=[];
 const pattern=/^COPY public\.([a-z_]+) \(([^\n]+)\) FROM stdin;\n([\s\S]*?)^\\\.\n/gm;
 for(const match of data.matchAll(pattern)){
  if(!/^[a-z_][a-z0-9_]*(?:, [a-z_][a-z0-9_]*)*$/.test(match[2]))throw Error('Unsupported archive column identifiers');
  copies.push({table:match[1],columns:match[2],records:match[3]});
 }
 return copies;
}
export function recordFingerprint(records){return createHash('sha256').update(records.split('\n').filter((_,i,a)=>i<a.length-1).sort().join('\n')).digest('hex');}
