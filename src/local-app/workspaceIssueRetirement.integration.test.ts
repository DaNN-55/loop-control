// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('removes issue data and database gates while keeping orders and a recoverable issue snapshot',async()=>{
 const f=await productionWorkspaceFixture({schemaThrough:215});
 try{
  const w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  await f.c.query("INSERT INTO local_identity.workspace_export_issues(workspace_id,episode_id,reason,created_by) VALUES($1,$2,'待清理测试问题',$3)",[w.id,f.episode,f.owner]);
  const rows=(await f.c.query('SELECT * FROM local_identity.workspace_export_issues')).rows;
  await writeFile(join(f.root,'issues-before-retirement.json'),JSON.stringify(rows));
  const migration=await readFile('db/current/216-retire-workspace-issues.sql','utf8');
  await f.c.query('BEGIN');await f.c.query(migration);await f.c.query('ROLLBACK');
  expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_export_issues')).rows[0].n).toBe(1);
  await f.c.query('TRUNCATE local_identity.workspace_export_issues');
  await f.c.query('INSERT INTO local_identity.workspace_export_issues SELECT (jsonb_populate_record(NULL::local_identity.workspace_export_issues,value)).* FROM jsonb_array_elements($1::jsonb)',[await readFile(join(f.root,'issues-before-retirement.json'),'utf8')]);
  expect((await f.c.query('SELECT reason FROM local_identity.workspace_export_issues')).rows[0].reason).toBe('待清理测试问题');
  await f.c.query(migration);
  expect((await f.c.query("SELECT to_regclass('local_identity.workspace_export_issues') value")).rows[0].value).toBeNull();
  const read=await fetch(f.origin+`/api/local/episodes/${f.episode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);expect((await read.json()).workspace).not.toHaveProperty('exportIssues');
  expect((await f.request('recordWorkspaceExportIssue',{workspaceId:w.id,expectedRevision:w.revision,reason:'旧客户端'})).status).toBe(410);
  expect((await f.c.query('SELECT count(*)::int count FROM public.episodes WHERE id=$1',[f.episode])).rows[0].count).toBe(1);
  expect(JSON.parse(await readFile(join(f.root,'issues-before-retirement.json'),'utf8'))).toHaveLength(1);
  const functions=(await f.c.query("SELECT pg_get_functiondef('local_identity.workspace_delivery_current(uuid,uuid)'::regprocedure) a,pg_get_functiondef('public.delete_episode(uuid,uuid)'::regprocedure) b")).rows[0];
  expect(functions.a+functions.b).not.toContain('workspace_export_issues');
  expect(functions.a).toContain("w.editor_authority='native'");
  const catalog=await fetch(f.origin+'/api/local/catalog?view=operations',{headers:{Cookie:'loop_owner_session='+f.token}});expect(catalog.status,await catalog.clone().text()).toBe(200);
 }finally{await f.close();}
},60000);
