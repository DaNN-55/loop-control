// @vitest-environment node
// Explicit isolated fixture only. Observe PostgreSQL's real role/RLS boundary
// and EXPLAIN plans; no Provider, production database or role changes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {beforeAll,it,expect} from 'vitest';

const fixturePath=process.env.LOOP_OWNER_RLS_TEST_FIXTURE;
assert(fixturePath,'Set LOOP_OWNER_RLS_TEST_FIXTURE to an approved isolated fixture');
const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
assert.equal(fixture.purpose,'owner-rls-initplans');assert.equal(fixture.testOnly,true);
assert.equal(fixture.database,'loop_t24_restore_sql20261026');
const deployment=JSON.parse(await readFile(fixture.deploymentFile,'utf8'));
assert.equal(deployment.database.host,'127.0.0.1');assert.equal(deployment.database.database,fixture.database);
const {sql,assertDatabase}=await import(fixture.nativeEnvironmentModule);assertDatabase();
const tables=['external_connections','external_connection_verifications','storyboard_audio_selections'] as const;
const keys=['connections','verifications','audio'] as const;
type Plan=Record<string,unknown> & {Plans?:Plan[]};
type Owner={id:string;connections:string[];verifications:string[];audio:string[]};
const owners:Owner[]=fixture.owners;
assert.equal(owners.length,2);
const uuid=(value:string)=>{assert(/^[0-9a-f-]{36}$/.test(value));return `'${value}'::uuid`;};
const scope=(i:number)=>`id IN (${owners.flatMap(o=>o[keys[i]]).map(uuid).join(',')})`;
const readRows=()=>`SELECT jsonb_build_object(${tables.map((t,i)=>`'${t}',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM (SELECT * FROM public.${t} WHERE ${scope(i)}) r)`).join(',')})`;
function asRole(role:'loop_app'|'loop_worker'|'loop_anonymous',owner:string|undefined,query:string){
 if(owner)uuid(owner);
 return sql(`BEGIN;SET SESSION AUTHORIZATION ${role};SET LOCAL loop.owner_id='${owner??''}';${query};ROLLBACK;`,fixture.database);
}
function nodes(plan:Plan):Plan[]{return[plan,...(plan.Plans??[]).flatMap(nodes)];}
let observations:Record<string,unknown>;
let plans:Plan[][];

beforeAll(async()=>{
 const identities=owners.map(owner=>JSON.parse(asRole('loop_app',owner.id,"SELECT jsonb_build_object('session',session_user,'current',current_user,'owner',local_identity.owner_id())")));
 const rows=owners.map(owner=>JSON.parse(asRole('loop_app',owner.id,readRows())));
 plans=tables.map((table,i)=>JSON.parse(asRole('loop_app',owners[0].id,`EXPLAIN (ANALYZE,BUFFERS,VERBOSE,FORMAT JSON) SELECT * FROM public.${table} WHERE ${scope(i)}`)));
 observations={identities,rows,plans,security:JSON.parse(sql(fixture.securitySql,fixture.database))};
 const output=process.env.LOOP_OWNER_RLS_EVIDENCE_FILE;
 if(output)await writeFile(output,JSON.stringify(observations,null,2)+'\n',{flag:'wx',mode:0o600});
});

for(const [i,table]of tables.entries())it(`${table} evaluates Owner identity once while preserving exact Owner rows`,()=>{
 const evidence=observations as {identities:{session:string;current:string;owner:string}[];rows:Record<string,{id:string}[]>[]};
 for(const [n,owner]of owners.entries()){
  expect(evidence.identities[n]).toEqual({session:'loop_app',current:'loop_app',owner:owner.id});
  expect(evidence.rows[n][table].map(row=>row.id).sort()).toEqual([...owner[keys[i]]].sort());
 }
 const initplans=nodes(plans[i][0].Plan as Plan).filter(node=>node['Parent Relationship']==='InitPlan'&&JSON.stringify(node.Output??[]).includes('local_identity.owner_id()'));
 expect(initplans.length,`${table}: Owner must be an uncorrelated initplan`).toBeGreaterThan(0);
 for(const plan of initplans)expect(plan['Actual Loops']).toBe(1);
});

it('keeps role grants, policy scope and missing/foreign identity fences',()=>{
 expect(observations.security).toEqual(fixture.securityBefore);
 for(const role of fixture.securityBefore.roles)expect({super:role.super,bypass:role.bypass}).toEqual({super:false,bypass:false});
 const empty=JSON.parse(asRole('loop_app',undefined,readRows()));
 for(const table of tables)expect(empty[table]).toEqual([]);
 const missing='00000000-0000-4000-8000-000000000000';
 const foreign=JSON.parse(asRole('loop_app',missing,readRows()));
 for(const table of tables)expect(foreign[table]).toEqual([]);
 for(const role of ['loop_worker','loop_anonymous'] as const){
  // These roles have no SELECT grants. Even a forged Owner GUC cannot upgrade
  // their session identity, and the original table access remains denied.
  for(const table of tables)expect(()=>asRole(role,owners[0].id,`SELECT id FROM public.${table} LIMIT 1`)).toThrow(/permission denied/);
 }
 const beforePath=process.env.LOOP_OWNER_RLS_BEFORE_EVIDENCE;
 if(beforePath){
  const before=JSON.parse(readFileSync(beforePath,'utf8'));
  expect(observations.rows).toEqual(before.rows);
 }
});

