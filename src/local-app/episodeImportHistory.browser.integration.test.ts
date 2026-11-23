// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {storyBrowser} from './storyBrowser.fixture';

it.skipIf(process.env.LOOP_STORY_E2E!=='1')('Owner finds a previous import after refresh and follows each member’s current stage',async()=>{
 const volume=await workspaceAudioVolume();
 const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath},migrations:['db/current/220-episode-batch-import.sql','db/current/223-manual-script-review-drafts.sql','db/current/225-structured-import-script.sql']}).catch(async cause=>{await volume.close();throw cause;});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const account=await f.post('configuration','createAccount',{name:'生产单批次历史验收',slug:'batch-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});
  expect(account.status,JSON.stringify(account.body)).toBe(200);
  const create=await f.post('episode-commands','create',{accountId:account.body.id,seriesVersionId:null,title:'手工新建'});
  expect(create.status,JSON.stringify(create.body)).toBe(200);

  const lamp=join(f.root,'街灯.txt'),rain=join(f.root,'夜雨.md');
  await writeFile(lamp,'街角亮起一盏灯。');await writeFile(rain,'# 夜雨\n\n窗外下起了雨。\n');
  const page=browser=await storyBrowser(f,'import-history','隔离 Studio153 验收');
  const waitForCount=(count:number)=>page.wait(`!Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent==='正在读取生产单…') && document.querySelectorAll('[data-episode-open]').length===${count}`);
  const titles=()=>page.evaluate("Array.from(document.querySelectorAll('[data-episode-open]')).map(e=>e.textContent)");
  const checkFiles=async(...files:string[])=>{
   await page.cli('select','dialog select[name=accountId]',account.body.id);
   await page.cli('upload','dialog input[name=scripts]',...files);
   for(const title of ['街灯','夜雨']){
    await page.click('编辑 '+title);
    await page.cli('select','dialog .episode-import-editor select[name=seriesVersionId]','unassigned');
    await page.click('保存');
   }
   await page.click('检查重复');await page.cli('wait','--text','重复检查完成，可提交创建。');
  };
  await page.click('关闭生产单详情');
  await page.click('新建生产单');await page.cli('find','role','menuitem','click','--name','批量上传','--exact');await checkFiles(lamp,rain);await page.click('提交创建');
  await page.cli('wait','--text','成功 2');
  await page.click('查看本批');
  await waitForCount(2);
  expect(await titles()).toEqual(['夜雨','街灯']);
  await page.click('退出批次筛选');

  await page.click('新建生产单');await page.cli('find','role','menuitem','click','--name','批量上传','--exact');await page.click('开始新批次');
  await checkFiles(lamp,rain);
  await page.cli('select','dialog .episode-batch-file-preview:last-of-type select[name=duplicate]','create');
  await page.click('提交创建');await page.cli('wait','--text','成功 1 · 跳过 1 · 失败 0');
  await page.cli('reload');

  await page.click('新建生产单');await page.cli('find','role','menuitem','click','--name','导入记录','--exact');
  await page.wait("document.querySelectorAll('dialog .episode-import-history li').length===2");
  await page.cli('click','dialog .episode-import-history li:last-child button');
  await waitForCount(2);
  await page.cli('select','select[name=batchStage]','script_review');await waitForCount(2);
  expect(await titles()).toEqual(['夜雨','街灯']);
  await page.click('街灯');await page.click('继续制作');
  await page.wait("document.querySelector('.script-studio-badge')?.textContent==='已确认' || location.search.includes('step=preparation')");
  await page.click('关闭生产单详情');
  await waitForCount(1);
  expect(await titles()).toEqual(['夜雨']);

  await page.cli('reload');await waitForCount(1);
  expect(await titles()).toEqual(['夜雨']);
  await page.cli('set','viewport','420','820');
  expect(await page.evaluate("(()=>{const r=document.querySelector('.episode-batch-scope').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()")).toBe(true);
  await page.capture('narrow-current-stage');
  await page.click('退出批次筛选');await waitForCount(5);
  expect(await titles()).toEqual(expect.arrayContaining(['手工新建','街灯','夜雨']));
  expect((await titles()).filter((title:string)=>title==='夜雨')).toHaveLength(2);
 }catch(error){await browser?.capture('failed').catch(()=>{});throw error;}
 finally{await browser?.close();await f.close();await volume.close();}
},120000);
