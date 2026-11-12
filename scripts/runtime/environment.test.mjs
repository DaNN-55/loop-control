// @vitest-environment node
import{it,expect,beforeEach}from'vitest';import{fileURLToPath}from'node:url';import{join}from'node:path';
const fixture={d:null,receipt:null,mode:0o700,link:false};
import{projectRoot,root,validateDeployment}from'./environment.mjs';
beforeEach(()=>{fixture.mode=0o700;fixture.link=false;const db={host:'127.0.0.1',port:54329,database:'loop_control',password:'synthetic-fixture-password'};fixture.d={version:1,purpose:'local-daily',projectRoot,runtimeRoot:root,port:5174,postgres:{profile:'loop-control',container:'loop-control-local-postgres',volume:'loop-control-local-data',image:'sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929'},database:{...db,user:'loop_app'},workerDatabase:{...db,user:'loop_worker'},mediaRoot:join(root,'volume/media'),stateDirectory:join(root,'state'),backupRoot:join(root,'backups/loop_control'),openChatCut:{root:join(root,'OpenChatCut'),port:5175},connections:{keychain:{runtimeRoot:root}},worker:{mountPath:join(root,'volume'),alignment:{cacheDirectory:join(root,'volume/media/whisperx-models')}}};fixture.receipt={passed:true,database:'loop_control',mediaRoot:fixture.d.mediaRoot,publicationFence:true};});
it('selects the daily deployment with no stage pointer or Supabase configuration',()=>{expect(projectRoot).toBe(fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''));expect(validateDeployment(fixture.d)).toMatchObject({port:5174,database:{database:'loop_control'},runtimeRoot:root});});
it.each(['host','database','user','port'])('rejects a changed application %s',field=>{fixture.d.database[field]=field==='port'?55472:'other';expect(()=>validateDeployment(fixture.d)).toThrow();});
it('rejects Worker cross-database bindings and external runtime paths',()=>{fixture.d.workerDatabase.database='loop_imported';expect(()=>validateDeployment(fixture.d)).toThrow();fixture.d.workerDatabase.database='loop_control';fixture.d.openChatCut.root=join(projectRoot,'.loop-control/stage-b/verified/OpenChatCut');expect(()=>validateDeployment(fixture.d)).toThrow();});
it('rejects foreign runtime identities',()=>{fixture.d.runtimeRoot=join(projectRoot,'.loop-control/stage-d');expect(()=>validateDeployment(fixture.d)).toThrow();});

it('accepts only native database ports bound to its dedicated PostgreSQL configuration',()=>{
 fixture.d.postgres={kind:'native',binDirectory:'/fixture/postgresql/bin',dataDirectory:join(root,'postgres/data'),socketDirectory:join(root,'postgres/socket'),systemIdentifier:'7542380466584442201',majorVersion:17,port:55431,adminUser:'postgres'};
 fixture.d.database.port=55431;fixture.d.workerDatabase.port=55431;
 expect(validateDeployment(fixture.d).postgres.kind).toBe('native');fixture.d.workerDatabase.port=54329;expect(()=>validateDeployment(fixture.d)).toThrow('database binding mismatch');
});
it('keeps the pinned container identity checks when a native kind is not selected',()=>{fixture.d.postgres.kind='other';expect(()=>validateDeployment(fixture.d)).toThrow('identity mismatch');delete fixture.d.postgres.kind;fixture.d.postgres.image='foreign';expect(()=>validateDeployment(fixture.d)).toThrow('identity mismatch');});
