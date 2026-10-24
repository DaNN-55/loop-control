// Actual headed Chrome through agent-browser; DOM reads only for assertions.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {targetConfiguration,targetId} from './restore.mjs';
import {writePrivateFile} from './environment.mjs';
assert.ok(process.argv.includes('--verified'));assert.equal(targetId,'loop-control-stage-b-verified');
const c=targetConfiguration(),directory=join(c.stateRoot,'c-followup'),ids=JSON.parse(readFileSync(join(directory,'fixtures.json'))),session='c-followup-437166911c13';
const log=join(directory,'browser-actions-'+Date.now()+'.jsonl');writePrivateFile(log,'');
function command(args,input){let result;try{const output=execFileSync('agent-browser',['--session',session,'--json',...args],{input,encoding:'utf8',timeout:35000});result=JSON.parse(output);appendFileSync(log,JSON.stringify({at:new Date().toISOString(),args,result})+'\n');assert.equal(result.success,true);return result.data;}catch(error){appendFileSync(log,JSON.stringify({at:new Date().toISOString(),args,error:String(error)})+'\n');throw error;}}
function click(name){return command(['find','role','button','click','--name',name,'--exact']);}
function wait(text){return command(['wait','--text',text]);}
function dom(){return command(['eval','--stdin'],`({rows:Array.from(document.querySelectorAll('.episode-row')).map(r=>({title:r.querySelector('strong')?.textContent,id:r.querySelector('small')?.textContent})),pagination:document.querySelector('.pagination-controls')?.innerText,summary:document.querySelector('.summary-count')?.innerText})`).result;}
function shot(name){command(['screenshot',join(c.projectRoot,'docs/verification/stage-c-followup',name+'.png')]);}
if(process.argv.includes('--detail')) {
 const {sql,quote,assertContainer}=await import('./backup.mjs');const {targetContainer}=await import('./restore.mjs');assertContainer(targetContainer,targetId);
 const initialTitle=sql(`select title from episodes where id=${quote(ids.detail)} and account_id=${quote(ids.account)}`,targetContainer);
 const title=initialTitle==='C补验-详情-浏览器提交'?'C补验-详情-浏览器提交-复验':'C补验-详情-浏览器提交',updatedTitle='C补验-详情-恢复可见';
 const original=sql(`select row_to_json(t) from tasks t where id=${quote(ids.task)} and episode_id=${quote(ids.detail)}`,targetContainer);assert.ok(original);
 writePrivateFile(join(directory,'detail-task-before.json'),original+'\n');
 try {
  if(command(['eval','--stdin'],`Boolean(document.querySelector('.episode-detail-drawer'))`).result)click('关闭生产单详情');
  click('生产单');wait('生产单状态');command(['select','.filters label:first-child select',ids.account]);command(['select','.filters label:nth-child(2) select',ids.series]);wait('47 个生产单');
  for(let page=1;page<=3;page++){if(dom().rows.some(row=>row.title===initialTitle))break;click('下一页');wait(`第 ${page+1} / 3 页`);}
  click('生产单操作：'+initialTitle);command(['find','role','menuitem','click','--name','重命名','--exact']);command(['find','label','新生产单标题','fill',title]);click('保存新标题');wait('生产单标题已更新');
  command(['select','.filters label:nth-child(2) select','全部系列']);command(['select','.filters label:nth-child(2) select',ids.series]);wait('第 1 / 3 页');wait(title);shot('title-submitted');
  assert.equal(sql(`select title from episodes where id=${quote(ids.detail)}`,targetContainer),title);
  sql(`update tasks set status='ready',completed_at=null,last_result='{}' where id=${quote(ids.task)} and episode_id=${quote(ids.detail)}`,targetContainer);
  command(['find','text',title,'click','--exact']);command(['wait','.episode-detail-drawer']);command(['wait','--text','排队']);shot('detail-ready');
  const {randomUUID}=await import('node:crypto');const {ensurePrivateDirectory}=await import('./environment.mjs');
  const relativePath=`episodes/${ids.detail}/c-followup/browser-proof-${Date.now()}.txt`;const artifactText='C stage isolated browser verification note\n';ensurePrivateDirectory(join(c.mediaRoot,`episodes/${ids.detail}/c-followup`));writePrivateFile(join(c.mediaRoot,relativePath),artifactText);
  const previousArtifactCount=Number(sql(`select count(*) from artifacts where episode_id=${quote(ids.detail)}`,targetContainer));
  const artifactId=randomUUID();const {digest}=await import('./backup.mjs');
  sql(`insert into artifacts(id,episode_id,artifact_type,relative_path,sha256,file_size) values(${quote(artifactId)},${quote(ids.detail)},'browser_verification_note',${quote(relativePath)},${quote(digest(artifactText))},${Buffer.byteLength(artifactText)})`,targetContainer);
  command(['wait','--fn',`Array.from(document.querySelectorAll('.episode-row')).some(row=>row.querySelector('strong')?.textContent===${JSON.stringify(title)} && Number(row.children[5]?.textContent)===${previousArtifactCount+1})`]);shot('detail-artifact-count-updated');
  const visible=command(['eval','--stdin'],'document.visibilityState').result;assert.equal(visible,'visible');
  let begin=Date.now();
  if(process.argv.includes('--native-background')) {
    writePrivateFile(join(directory,'browser-phase.json'),JSON.stringify({phase:'ready-to-background'})+'\n');console.log('Ready for native Chrome tab background');
    let hidden=false;for(let i=0;i<120;i++){if(command(['eval','--stdin'],'document.visibilityState').result==='hidden'){hidden=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(hidden,'Native tab must actually become hidden');begin=Date.now();
  } else command(['tab','new','about:blank']);
  sql(`update tasks set status='completed',completed_at=clock_timestamp(),last_result='{"browser_delta":"observed_after_resume"}' where id=${quote(ids.task)} and episode_id=${quote(ids.detail)};update episodes set title=${quote(updatedTitle)} where id=${quote(ids.detail)} and account_id=${quote(ids.account)}`,targetContainer);
  await new Promise(resolve=>setTimeout(resolve,12000));const end=Date.now();
  if(process.argv.includes('--native-background')) {
    writePrivateFile(join(directory,'browser-phase.json'),JSON.stringify({phase:'ready-to-resume'})+'\n');console.log('Ready for native Chrome tab resume');
    let visible=false;for(let i=0;i<120;i++){if(command(['eval','--stdin'],'document.visibilityState').result==='visible'){visible=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(visible,'Native tab must resume');
  } else command(['tab','t1']);wait(updatedTitle);command(['wait','--text','已完成']);command(['wait','--fn',`Array.from(document.querySelectorAll('.episode-row strong')).some(row=>row.textContent===${JSON.stringify(updatedTitle)})`]);shot('detail-after-resume');
  const resources=command(['eval','--stdin'],`performance.getEntriesByType('resource').filter(r=>r.name.includes('/rpc/read_episode_production')).map(r=>({start:performance.timeOrigin+r.startTime,duration:r.duration,bytes:r.encodedBodySize}))`).result;
  assert.equal(resources.filter(r=>r.start>begin+500 && r.start<end-500).length,0);
  const after=command(['eval','--stdin'],`({visibility:document.visibilityState,title:document.querySelector('.episode-detail-drawer')?.innerText,list:document.querySelector('.episode-table')?.innerText})`).result;assert.equal(after.visibility,'visible');assert.ok(after.title.includes(updatedTitle));assert.ok(after.list.includes(updatedTitle));
  click('关闭生产单详情');command(['reload']);wait('系列运营概览');click('生产单');wait('生产单状态');command(['select','.filters label:first-child select',ids.account]);wait(updatedTitle);shot('title-after-reload');
  command(['find','text',updatedTitle,'click','--exact']);command(['wait','.episode-detail-drawer']);command(['wait','--text','已完成']);shot('detail-after-reload');click('关闭生产单详情');
  click('审核');wait('待审核 Episode');command(['wait','--text','第 1 / 2 页']);click('下一页');wait('第 2 / 2 页');shot('reviews-page2');
  const result={target:targetId,episode:ids.detail,actualBrowserSubmit:true,titlePersistedInDatabase:true,selectedDetailSurvivesReordering:true,actualChromeBackground:{begin,end,ms:end-begin,nativeTabSwitch:process.argv.includes('--native-background'),noDetailRequests:true,resources},visibleCatalogUpdated:true,artifactOnlyUpdateRefreshed:true,artifactId,artifactRelativePath:relativePath,fullReloadPersisted:true,reviewQueuePage2:true,controlledTaskStatus:'Real DB ready->completed; no execution or Provider calls',log};writePrivateFile(join(directory,'browser-detail.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 } finally {
  const before=JSON.parse(original);sql(`update tasks set status=${quote(before.status)},completed_at=${before.completed_at?quote(before.completed_at):'null'},last_result=${quote(JSON.stringify(before.last_result))}::jsonb where id=${quote(ids.task)} and episode_id=${quote(ids.detail)}`,targetContainer);
 }
 process.exit(0);
}
if(process.argv.includes('--status')) {
 if(!command(['eval','--stdin'],`Boolean(document.querySelector('.system-status-panel'))`).result)click('系统状态：需处理');
 const inspect=()=>command(['eval','--stdin'],`Array.from(document.querySelectorAll('.system-status-item')).map(item=>({label:item.querySelector('strong')?.textContent,state:item.querySelector('div > span')?.textContent,text:item.innerText})).filter(item=>['调度检查','事件提醒','每日健康检查','完整备份','部分快照'].includes(item.label))`).result;
 wait('有 4 条提醒');const before=inspect();assert.equal(before.length,5);assert.deepEqual(before.map(x=>x.state),['待确认','需处理','正常','正常','正常']);
 command(['scroll','down','650','--selector','.system-status-panel']);shot('status-operations');
 click('刷新系统状态');command(['wait','--load','networkidle']);const refreshed=inspect();assert.deepEqual(refreshed,before);shot('status-refreshed');
 command(['reload']);wait('系列运营概览');click('系统状态：需处理');wait('有 4 条提醒');const reloaded=inspect();assert.deepEqual(reloaded,before);command(['scroll','down','650','--selector','.system-status-panel']);shot('status-after-reload');
 const result={target:targetId,source:'Existing real T09 operation evidence, not synthetic successful results',before,refreshedEqual:true,reloadEqual:true,notificationNotDeliveryReceipt:true,noOperationsInvoked:true,log};writePrivateFile(join(directory,'browser-status.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({target:targetId,operations:before.map(x=>({label:x.label,state:x.state})),refreshedEqual:true,reloadEqual:true,log}));click('关闭系统状态详情');process.exit(0);
}
if(process.argv.includes('--operations')) {
 click('系列运营'); wait('系列运营概览');
 command(['select','select[aria-label="运营系列筛选"]',ids.series]); wait('47 个生产单'); wait('23 个待审核包'); wait('23 个阻塞项');
 const inspect=()=>command(['eval','--stdin'],`({stages:Array.from(document.querySelectorAll('.operations-stage-grid strong')).map(n=>Number(n.textContent)),pending:document.querySelectorAll('.operations-detail-grid .operations-list:first-child li').length,blocked:document.querySelectorAll('.operations-blocker-list > ul > li').length,episodes:document.querySelectorAll('.operations-episode-row').length})`).result;
 const first=inspect();assert.equal(first.stages.reduce((n,x)=>n+x,0),47);assert.equal(first.pending,20);assert.equal(first.blocked,20);assert.equal(first.episodes,20);shot('operations-series-page1');
 command(['click','.operations-detail-grid .operations-list:first-child .pagination-controls button:last-child']);
 command(['wait','--fn',`document.querySelectorAll('.operations-detail-grid .operations-list:first-child li').length===3`]);
 assert.equal(inspect().pending,3);assert.equal(inspect().blocked,20);
 command(['click','.operations-blocker-list .pagination-controls button:last-child']);
 command(['wait','--fn',`document.querySelectorAll('.operations-blocker-list > ul > li').length===3`]);
 const second=inspect();assert.equal(second.pending,3);assert.equal(second.blocked,3);assert.equal(second.stages.reduce((n,x)=>n+x,0),47);shot('operations-highlights-page2');
 const result={target:targetId,globalStageTotal:47,pending:23,blocked:23,first,second,independentPages:true,log};writePrivateFile(join(directory,'browser-operations.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exit(0);
}
click('生产单');wait('生产单状态');command(['select','.filters label:first-child select',ids.account]);command(['select','.filters label:nth-child(2) select','全部系列']);command(['select','select[aria-label="生产单状态"]','active']);wait('1005 个生产单');wait('第 1 / 51 页');
let first=dom();assert.equal(first.rows.length,20);shot('catalog-page1');const all=[...first.rows];
for(let page=2;page<=51;page++){click('下一页');wait(`第 ${page} / 51 页`);const current=dom();assert.equal(current.rows.length,page===51?5:20);all.push(...current.rows);if(page===2){shot('catalog-page2');click('上一页');wait('第 1 / 51 页');assert.deepEqual(dom().rows,first.rows);click('下一页');wait('第 2 / 51 页');}}
assert.equal(all.length,1005);assert.equal(new Set(all.map(r=>r.id)).size,1005);shot('catalog-page51');
command(['select','.filters label:nth-child(2) select',ids.series]);wait('47 个生产单');wait('第 1 / 3 页');assert.equal(dom().rows.length,20);shot('catalog-series');
command(['select','.filters label:nth-child(2) select',ids.emptySeries]);wait('0 个生产单');assert.equal(dom().rows.length,0);shot('catalog-empty');
command(['select','.filters label:nth-child(2) select','全部系列']);command(['select','select[aria-label="生产单状态"]','archived']);wait('2 个生产单');assert.equal(dom().rows.length,2);shot('catalog-archived');
command(['select','select[aria-label="生产单状态"]','all']);wait('1007 个生产单');assert.equal(dom().rows.length,20);shot('catalog-all');
const result={target:targetId,browser:'headed Chrome, agent-browser named isolated session',pages:51,uniqueRows:1005,tailRows:5,previousPageEqual:true,seriesRows:47,emptySeriesRows:0,archivedRows:2,allRows:1007,filterResetPage:true,log};
writePrivateFile(join(directory,'browser-pagination.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
