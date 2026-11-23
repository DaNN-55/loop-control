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
  await browser.click('新建生产单');await browser.cli('find','role','menuitem','click','--name','批量上传','--exact');
  await browser.cli('select','dialog select[name=accountId]',account.body.id);
  const template=join(f.root,'template.xlsx'),upload=join(f.root,'三个街角.xlsx');
  const format='dialog footer .episode-batch-upload-format';
  const templateLink=format+' a[download]';
  expect(await browser.snapshot()).not.toContain('link "下载 Excel 模板"');
  await browser.cli('focus',format+' summary');
  await browser.cli('press','Enter');
  await browser.cli('download',templateLink,template);
  await browser.cli('focus',format+' summary');
  await browser.cli('press','Enter');
  const workbook=await loadWorkbook(fromBuffer(await readFile(template)));
  const orders=getSheet(workbook,'生产单')!,shots=getSheet(workbook,'分镜')!;
  expect(getRangeValues(orders,'A1:E1')).toEqual([['系列','生产单编号','标题','脚本正文','目标时长']]);
  expect(getRangeValues(shots,'A1:G1')).toEqual([['生产单编号','镜头序号','画面描述','视频提示词','口播','字幕','镜头时长']]);
  expect(getCell(shots,2,1)?.value).toBe(getCell(shots,3,1)?.value);
  const oldTemplate=createWorkbook(),oldUpload=join(f.root,'旧版四列.xlsx');
  writeRange(addWorksheet(oldTemplate,'生产单'),'A1',[['生产单编号','标题','脚本正文','目标时长'],['旧-01','旧模板','旧模板脚本。',8]]);
  addWorksheet(oldTemplate,'分镜');
  await writeFile(oldUpload,await workbookToBytes(oldTemplate));
  await browser.cli('upload','dialog input[name=scripts]',oldUpload);
  await browser.cli('wait','--text','待选系列');
  expect(await browser.evaluate("!!document.querySelector('button[aria-label=\"移除文件\"] svg')")).toBe(true);
  await browser.cli('hover','button[aria-label="移除文件"]');
  await browser.wait(`(()=>{
   const button=document.querySelector('button[aria-label="移除文件"]');
   const swatch=document.createElement('div');
   swatch.style.backgroundColor='var(--color-bg-error-primary)';
   button.append(swatch);
   const background=getComputedStyle(button).backgroundColor,expected=getComputedStyle(swatch).backgroundColor;
   swatch.remove();
   return background===expected;
  })()`);
  await browser.click('移除文件');
  const legacyWorkbook=createWorkbook(),legacyUpload=join(f.root,'旧版五列.xlsx');
  writeRange(addWorksheet(legacyWorkbook,'生产单'),'A1',[['生产单编号','标题','脚本正文','目标时长','系列'],['旧-02','旧版系列模板','旧模板脚本。',8,'三个街角']]);
  addWorksheet(legacyWorkbook,'分镜');
  await writeFile(legacyUpload,await workbookToBytes(legacyWorkbook));
  await browser.cli('upload','dialog input[name=scripts]',legacyUpload);
  await browser.cli('wait','--text','系列：三个街角');
  await browser.click('移除文件');
  writeRange(orders,'A2',[['三个街角','001','雨前','最早落下的一滴雨。',8],['第二个系列','002','雨中','原稿中的尾声还在。',11],['未知系列','002','雨后','',null]]);
  writeRange(shots,'A2',[['002',2,'车驶入雨幕','从街尾跟拍','车来了。','第二班车',5],['002',2,'玻璃上有雨滴','固定特写','','第一滴雨',6],['写错',1,'倒映的路灯','缓慢横移','','',7]]);
  await writeFile(upload,await workbookToBytes(workbook));
  await browser.cli('upload','dialog input[name=scripts]',upload);
  await browser.cli('wait','--text','生产单编号重复');
  const orders2='dialog [data-sheet=orders][data-row="2"]';
  const orders3='dialog [data-sheet=orders][data-row="3"]';
  const orders4='dialog [data-sheet=orders][data-row="4"]';
  const shots4='dialog [data-sheet=shots][data-row="4"]';
  expect(await browser.evaluate("document.querySelector('dialog [data-sheet=orders][data-row=\"4\"] .episode-import-title').textContent")).toContain('未找到系列');
  expect(await browser.evaluate("document.querySelectorAll('.episode-workbook-unmatched [data-sheet=shots]').length")).toBe(3);
  expect(await browser.evaluate("document.querySelectorAll('dialog .episode-import-editor').length")).toBe(0);
  expect(await browser.evaluate("document.querySelector('dialog footer .episode-batch-upload-format')?.textContent")).toContain('格式说明');
  expect(await browser.evaluate("document.querySelector('dialog .episode-batch-series-summary')?.textContent")).toContain('1 张生产单待确认系列');
  await browser.cli('click',orders4+' > .episode-import-disclosure');
  expect(await browser.evaluate(`document.querySelector('${orders4} .episode-import-row-body .form-error')===null`)).toBe(true);


  await browser.click('编辑 雨前');
  expect(await browser.evaluate(`(()=>{
   const fields=document.querySelector('.episode-import-order-fields');
   const top=name=>fields.querySelector('[name='+name+']').getBoundingClientRect().top;
   return top('orderNo')===top('title')&&top('title')===top('duration');
  })()`)).toBe(true);
  await browser.cli('set','viewport','420','820');
  expect(await browser.evaluate("(()=>{const d=document.querySelector('dialog.episode-batch-import');return d.scrollWidth<=d.clientWidth;})()")).toBe(true);
  await browser.capture('narrow-order-editor');
  await browser.cli('set','viewport','1280','820');
  await browser.cli('fill',orders2+' input[name=title]','取消的标题');
  await browser.cli('fill',orders2+' input[name=duration]','35');
  await browser.click('取消');
  expect(await browser.evaluate("document.querySelector('dialog [data-sheet=orders][data-row=\"2\"] .episode-import-disclosure').textContent")).toContain('8 秒');
  expect(await browser.evaluate("document.querySelector('dialog [data-sheet=orders][data-row=\"2\"] .episode-import-title').textContent")).toBe('雨前');

  await browser.click('编辑 雨后');
  await browser.cli('fill',orders4+' input[name=orderNo]','003');
  await browser.cli('select',orders4+' select[name=seriesVersionId]','unassigned');
  expect(await browser.evaluate("document.querySelectorAll('dialog .episode-import-editor').length")).toBe(1);
  expect(await browser.evaluate("document.querySelectorAll('.episode-workbook-unmatched [data-sheet=shots]').length")).toBe(3);
  await browser.click('保存');
  expect(await browser.evaluate("document.querySelector('dialog [data-sheet=orders][data-row=\"2\"] .episode-import-summary').textContent")).toContain('系列：三个街角');
  expect(await browser.evaluate("document.querySelector('dialog [data-sheet=orders][data-row=\"3\"] .episode-import-summary').textContent")).toContain('系列：第二个系列');
  await browser.cli('wait','--text','找不到对应的生产单');

  await browser.cli('click',shots4+' .episode-import-edit');
  await browser.cli('fill',shots4+' input[name=orderNo]','003');
  await browser.click('取消');
  expect(await browser.evaluate("!!document.querySelector('.episode-workbook-unmatched [data-row=\"4\"]')")).toBe(true);
  await browser.cli('click',shots4+' .episode-import-edit');
  await browser.cli('fill',shots4+' input[name=orderNo]','003');
  await browser.click('保存');
  await browser.wait("!document.querySelector('.episode-workbook-unmatched')");
  await browser.wait('!!document.querySelector('+JSON.stringify(orders4+' [data-sheet=shots][data-row="4"]')+')');
  expect(await browser.evaluate("document.querySelector('dialog [data-sheet=orders][data-row=\"4\"] [data-sheet=shots] .episode-import-disclosure').textContent")).toContain('镜头 1');

  await browser.cli('click',orders3+' > .episode-import-disclosure');
  await browser.wait("document.querySelectorAll('dialog [data-sheet=orders][data-row=\"3\"] [data-sheet=shots]').length===2");
  expect(await browser.evaluate("document.querySelector('dialog [data-sheet=orders][data-row=\"3\"] .episode-import-row-body').lastElementChild.classList.contains('episode-workbook-shots')")).toBe(true);
  await browser.cli('wait','--text','镜头序号重复');
  await browser.cli('click',orders3+' [data-sheet=shots][data-row="3"] > .episode-import-disclosure');
  expect(await browser.evaluate(`(()=>{
   const copy=document.querySelector('dl.episode-import-shot-copy:not(:empty)');
   return parseFloat(getComputedStyle(copy.querySelector('dt')).fontSize)<parseFloat(getComputedStyle(copy.querySelector('dd')).fontSize)
    &&getComputedStyle(copy).backgroundColor!=='rgba(0, 0, 0, 0)';
  })()`)).toBe(true);
  const shots3='dialog [data-sheet=shots][data-row="3"]';
  await browser.cli('click',shots3+' .episode-import-edit');
  await browser.cli('fill',shots3+' input[name=sequence]','1');
  await browser.click('保存');
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
    await browser.wait("!document.querySelector('.script-studio-imported') || !!document.querySelector('.script-studio-imported').closest('[hidden]')");
    expect(browser.traffic).toContainEqual({command:'confirmScriptStudio',status:200,dropped:false});
    expect(browser.traffic).toContainEqual({command:'start',status:200,dropped:false});
    await browser.capture('shot-only-started');
    break;
   }
   await browser.click('关闭生产单详情');
   await browser.click('新建生产单');await browser.cli('find','role','menuitem','click','--name','批量上传','--exact');
   await browser.cli('wait','--text','成功 3');
  }
 }catch(error){await browser?.capture('failed').catch(()=>{});throw error;}
 finally{await browser?.close();await f.close();await volume.close();}
},120000);
