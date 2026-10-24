// Build a credential-free network summary and SHA256 index, retaining raw HAR privately.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {targetConfiguration,targetId} from './restore.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');
const c=targetConfiguration(),base=join(c.stateRoot,'c-followup'),out=join(c.projectRoot,'docs/verification/stage-c-followup');
for(const name of ['http-result.json','browser-pagination.json','browser-operations.json','browser-status.json','browser-detail.json'])copyFileSync(join(base,name),join(out,name));
const files=readdirSync(base).filter(name=>name.endsWith('.har'));
const network=files.map(name=>{
 const har=JSON.parse(readFileSync(join(base,name))),entries=har.log.entries;
 const catalog=entries.filter(e=>new URL(e.request.url).pathname.endsWith('/rpc/read_episode_catalog')).map(e=>{
  const args=JSON.parse(e.request.postData?.text??'{}');
  let rows=null;try{const content=e.response.content;const body=content.encoding==='base64'?Buffer.from(content.text,'base64').toString():content.text;rows=JSON.parse(body).episodes.length;}catch{}
  if(rows!==null)assert.ok(rows<=20);
  return {at:e.startedDateTime,view:args.p_view??'operations',page:args.p_page??1,accountFiltered:Boolean(args.p_account_id),series:args.p_series_id??'all',visibility:args.p_visibility??'active',pendingPage:args.p_pending_page??1,blockedPage:args.p_blocked_page??1,status:e.response.status,responseBytes:e.response.content.size,returnedEpisodes:rows,ms:e.time};
 });
 const unboundedEpisodes=entries.filter(e=>{const u=new URL(e.request.url);return u.pathname.endsWith('/rest/v1/episodes')&&!u.searchParams.has('id');});assert.equal(unboundedEpisodes.length,0);
 const details=entries.filter(e=>new URL(e.request.url).pathname.endsWith('/rpc/read_episode_production')).map(e=>({at:e.startedDateTime,status:e.response.status,responseBytes:e.response.content.size,ms:e.time}));
 const status=entries.filter(e=>new URL(e.request.url).pathname==='/_system-status').map(e=>({at:e.startedDateTime,status:e.response.status,ms:e.time}));
 return {file:relative(c.projectRoot,join(base,name)),privateSensitive:true,acceptance:name==='browser-acceptance.har',requests:entries.length,catalog,detail:details,systemStatus:status,unboundedEpisodeListRequests:0};
});
writeFileSync(join(out,'browser-network.json'),JSON.stringify({target:targetId,rawCredentialsExcluded:true,har:network},null,2)+'\n');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const index=[];
function add(path,kind){const stat=statSync(path);if(stat.isDirectory()){for(const name of readdirSync(path).sort())add(join(path,name),kind);return;}if(!stat.isFile()||path===join(out,'evidence-index.json'))return;index.push({path:relative(c.projectRoot,path),kind,bytes:stat.size,sha256:hash(path)});}
add(out,'public-report');add(base,'private-raw');
const fixtures=JSON.parse(readFileSync(join(base,'fixtures.json')));add(join(c.mediaRoot,'episodes',fixtures.detail,'c-followup'),'isolated-real-text-artifact');
const sources=['src/App.tsx','src/App.test.tsx','src/episodes/episodeCatalog.ts','src/episodes/episodeCatalog.test.tsx','src/episodes/episodeCatalogChanges.test.ts','src/episodes/EpisodeProductionContainer.tsx','src/episodes/EpisodeProductionContainer.test.tsx','src/lib/database.types.ts','src/operations/OperationsWorkspace.tsx','src/observability/SystemStatusPanel.tsx','scripts/isolation/restore-vite.config.mjs','scripts/isolation/c-followup.mjs','scripts/isolation/catalog-verification.mjs','scripts/isolation/c-browser.mjs','scripts/isolation/c-evidence.mjs','supabase/migrations/20261024004749_episode_catalog_paging.sql','supabase/tests/episode_catalog_test.sql','docs/adr/0008-local-execution-and-migration-contract.md','docs/verification/stage-c-t09/README.md','docs/verification/stage-c-t10/README.md'];
for(const source of sources)add(join(c.projectRoot,source),'scoped-source');
const result={target:targetId,createdAt:new Date().toISOString(),privateRawNotForCommit:true,files:index};writeFileSync(join(out,'evidence-index.json'),JSON.stringify(result,null,2)+'\n');
for(const entry of index){assert.equal(hash(join(c.projectRoot,entry.path)),entry.sha256);assert.equal(statSync(join(c.projectRoot,entry.path)).size,entry.bytes);}
console.log(JSON.stringify({files:index.length,public:index.filter(x=>x.kind==='public-report').length,private:index.filter(x=>x.kind==='private-raw').length,scopedSources:sources.length,allHashesVerified:true,acceptanceCatalogRequests:network.find(x=>x.acceptance)?.catalog.length}));
