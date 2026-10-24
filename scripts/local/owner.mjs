// Explicit local password initialization/change. Password travels only via stdin.
import{restoreTarget}from'./native-restore.mjs';
import {sql} from './environment.mjs';
import {hashPassword} from '../../dist/local-app/local-app/password.js';
const id=process.argv[2];
const restored=process.argv[3]==='--initialize-restored';if(process.argv.length!==(restored?5:3))throw Error('Pass Owner UUID and optional --initialize-restored <new database>');
const database=restored?restoreTarget(process.argv[4]):'loop_imported';
const selectedSql=text=>sql(text,database);
if(restored&&(selectedSql('SELECT count(*) FROM local_identity.restore_record')!=='1'||selectedSql('SELECT count(*) FROM local_identity.credentials')!=='0'))throw Error('Only initialize an uninitialized restored Owner');
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id??''))throw Error('Pass the preserved Owner UUID');
let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>2048)throw Error('Password input too large');}
const password=text.replace(/\r?\n$/,'');const record=await hashPassword(password);
// The ID must already be an imported Owner; this command creates no memberships.
if(selectedSql(`select count(*) from public.account_memberships where user_id='${id}' and role='owner'`)==='0')throw Error('ID has no preserved Owner membership');
selectedSql(`begin;insert into local_identity.credentials(owner_id,password_digest) values('${id}','${JSON.stringify(record)}') on conflict(owner_id) do update set password_digest=excluded.password_digest,failed_attempts=0,locked_until=null,updated_at=now();update local_identity.sessions set revoked_at=now() where owner_id='${id}';commit;`);
console.log('Local password saved; prior local sessions revoked.');
