// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {loadWorkbook,workbookToBytes} from '@office-kit/xlsx/io';
import {fromBuffer} from '@office-kit/xlsx/node';
import {addWorksheet,createWorkbook,getSheet} from '@office-kit/xlsx/workbook';
import {getCell,getRangeValues,writeRange} from '@office-kit/xlsx/worksheet';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {storyBrowser} from './storyBrowser.fixture';

it.skipIf(process.env.LOOP_STORY_E2E!=='1')('Owner downloads and corrects an Excel workbook before reopening three waiting production orders',async()=>{
 const volume=await workspaceAudioVolume();
 const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath},migrations:['db/current/220-episode-batch-import.sql','db/current/223-manual-script-review-drafts.sql','db/current/225-structured-import-script.sql']}).catch(async cause=>{await volume.close();throw cause;});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const account=await f.post('configuration','createAccount',{name:'Excel 导入验收',slug:'excel-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});
  expect(account.status,JSON.stringify(account.body)).toBe(200);
  const series=await f.post('configuration','createSeries',{accountId:account.body.id,name:'三个街角',rules:{}});
  expect(series.status,JSON.stringify(series.body)).toBe(200);
  const otherSeries=await f.post('configuration','createSeries',{accountId:account.body.id,name:'第二个系列',rules:{}});
  expect(otherSeries.status).toBe(200);
  browser=await storyBrowser(f,'batch-excel','隔离 Studio153 验收');
  await browser.click('关闭生产单详情');
  await browser.click('批量新建');
  await browser.cli('select','dialog select[name=accountId]',account.body.id);
  const template=join(f.root,'template.xlsx'),upload=join(f.root,'三个街角.xlsx');
  await browser.cli('download','dialog a[download]',template);
  const workbook=await loadWorkbook(fromBuffer(await readFile(template)));
  const orders=getSheet(workbook,'生产单')!,shots=getSheet(workbook,'分镜')!;
  expect(getRangeValues(orders,'A1:E1')).toEqual([['生产单编号','标题','脚本正文','目标时长','系列']]);
  expect(getRangeValues(shots,'A1:G1')).toEqual([['生产单编号','镜头序号','画面描述','视频提示词','口播','字幕','镜头时长']]);
  expect(getCell(shots,2,1)?.value).toBe(getCell(shots,3,1)?.value);
  const oldTemplate=createWorkbook(),oldUpload=join(f.root,'旧版四列.xlsx');
  writeRange(addWorksheet(oldTemplate,'生产单'),'A1',[['生产单编号','标题','脚本正文','目标时长'],['旧-01','旧模板','旧模板脚本。',8]]);
  addWorksheet(oldTemplate,'分镜');
  await writeFile(oldUpload,await workbookToBytes(oldTemplate));
  await browser.cli('upload','dialog input[name=scripts]',oldUpload);
  await browser.cli('wait','--text','请选择系列。');
  await browser.click('移除文件');
  writeRange(orders,'A2',[['001','雨前','最早落下的一滴雨。',8,'三个街角'],['002','雨中','原稿中的尾声还在。',11,'第二个系列'],['002','雨后','',null,'未知系列']]);
  writeRange(shots,'A2',[['002',2,'车驶入雨幕','从街尾跟拍','车来了。','第二班车',5],['002',2,'玻璃上有雨滴','固定特写','','第一滴雨',6],['写错',1,'倒映的路灯','缓慢横移','','',7]]);
  await writeFile(upload,await workbookToBytes(workbook));
  await browser.cli('upload','dialog input[name=scripts]',upload);
  await browser.cli('wait','--text','生产单编号重复');
  const orders4='dialog details[data-sheet=orders][data-row="4"]';
  await browser.cli('scrollintoview',orders4+' summary');
  await browser.cli('click',orders4+' summary');
  await browser.wait('!!document.querySelector('+JSON.stringify(orders4+' input[name=orderNo]')+')');
  await browser.cli('fill',orders4+' input[name=orderNo]','003');
  await browser.cli('select',orders4+' select[name=seriesVersionId]','unassigned');
  expect(await browser.evaluate("document.querySelector('dialog details[data-sheet=orders][data-row=\"2\"] summary').textContent")).toContain('系列：三个街角');
  expect(await browser.evaluate("document.querySelector('dialog details[data-sheet=orders][data-row=\"3\"] summary').textContent")).toContain('系列：第二个系列');
  await browser.cli('wait','--text','找不到对应的生产单');
  const shots4='dialog details[data-sheet=shots][data-row="4"]';
  await browser.cli('scrollintoview',shots4+' summary');
  await browser.cli('click',shots4+' summary');
  await browser.wait('!!document.querySelector('+JSON.stringify(shots4+' input[name=orderNo]')+')');
  await browser.cli('fill',shots4+' input[name=orderNo]','003');
  await browser.cli('wait','--text','镜头序号重复');
  const shots3='dialog details[data-sheet=shots][data-row="3"]';
  await browser.cli('scrollintoview',shots3+' summary');
  await browser.cli('click',shots3+' summary');
  await browser.wait('!!document.querySelector('+JSON.stringify(shots3+' input[name=sequence]')+')');
  await browser.cli('fill',shots3+' input[name=sequence]','1');
  await browser.click('检查重复');
  await browser.cli('wait','--text','重复检查完成，可提交创建。');
  await browser.cli('set','viewport','420','820');
  expect(await browser.evaluate("(()=>{const d=document.querySelector('dialog.episode-batch-import');return d.scrollWidth<=d.clientWidth;})()")).toBe(true);
  await browser.capture('corrected-preview');
  await browser.click('提交创建');
  await browser.cli('wait','--text','成功 3');
  expect(browser.traffic.some(record=>['start','confirmScriptStudio'].includes(record.command))).toBe(false);
  for(const [index,title] of ['雨前','雨中','雨后'].entries()){
   await browser.cli('click','.episode-batch-results li:nth-child('+(index+1)+') button');
   await browser.wait("document.querySelector('.script-studio-badge')?.textContent==='待确认'");
   await browser.cli('reload');
   await browser.wait("document.querySelector('.script-studio-badge')?.textContent==='待确认'");
   expect(await browser.evaluate("document.querySelector('textarea[name=script]')?.value")).toBe(['最早落下的一滴雨。','原稿中的尾声还在。',''][index]);
   if(title==='雨中'){
    const text=await browser.evaluate("document.querySelector('[aria-label=分镜预览]')?.innerText");
    expect(text).toContain('玻璃上有雨滴');
    expect(text).toContain('固定特写');
    expect(text).toContain('第一滴雨');
    expect(text).toContain('车来了。');
    expect(text.indexOf('玻璃上有雨滴')).toBeLessThan(text.indexOf('车驶入雨幕'));
    await browser.capture('reopened-structured-source');
   }
   if(title==='雨后'){
    expect(await browser.evaluate("document.querySelector('[aria-label=分镜预览]')?.innerText")).toContain('倒映的路灯');
    await browser.click('继续制作');
    await browser.cli('wait','--text','分镜台');
    await browser.wait("!document.querySelector('.script-studio-imported') || document.querySelector('.script-studio-imported').closest('[hidden]')");
    expect(browser.traffic).toContainEqual({command:'confirmScriptStudio',status:200,dropped:false});
    expect(browser.traffic).toContainEqual({command:'start',status:200,dropped:false});
    await browser.capture('shot-only-started');
    break;
   }
   await browser.click('关闭生产单详情');
   await browser.click('批量新建');
   await browser.cli('wait','--text','成功 3');
  }
 }catch(error){await browser?.capture('failed').catch(()=>{});throw error;}
 finally{await browser?.close();await f.close();await volume.close();}
},120000);
