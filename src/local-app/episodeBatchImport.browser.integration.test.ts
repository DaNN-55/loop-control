// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {storyBrowser} from './storyBrowser.fixture';

it.skipIf(process.env.LOOP_STORY_E2E!=='1')('Owner browser edits a mixed-script import, recovers a lost result and reopens the waiting source',async()=>{
 const volume=await workspaceAudioVolume();
 const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath},migrations:['db/current/220-episode-batch-import.sql']}).catch(async cause=>{await volume.close();throw cause;});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const account=await f.post('configuration','createAccount',{name:'批量导入浏览器验收',slug:'batch-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});
  expect(account.status,JSON.stringify(account.body)).toBe(200);
  const series=await f.post('configuration','createSeries',{accountId:account.body.id,name:'街道故事',rules:{}});
  expect(series.status,JSON.stringify(series.body)).toBe(200);
  const txt=join(f.root,'街角.txt'),md=join(f.root,'夜雨.md');
  const revised='路灯在街角亮起。';
  await writeFile(md,'系列：街道故事\n# 夜雨\n\n窗外下起了雨。\n');
  browser=await storyBrowser(f,'batch-text','隔离 Studio153 验收');
  await browser.click('关闭生产单详情');
  await browser.click('批量新建');
  await browser.cli('press','Escape');
  await browser.wait("!document.querySelector('dialog.episode-batch-import')");
  expect(await browser.evaluate('document.activeElement.textContent')).toBe('批量新建');
  await browser.click('批量新建');
  await browser.cli('select','dialog select[name=accountId]',account.body.id);
  expect(await browser.evaluate("document.querySelector('.episode-batch-target select[name=seriesVersionId]')===null")).toBe(true);
  await browser.evaluate("document.querySelector('dialog input[name=scripts]').addEventListener('click',event=>{event.preventDefault();event.target.dataset.activated='true';},{once:true})");
  await browser.cli('focus','dialog .episode-batch-upload-slot');
  await browser.cli('press','Enter');
  expect(await browser.evaluate("document.querySelector('dialog input[name=scripts]').dataset.activated")).toBe('true');
  const dropped=[
   {name:'街角.txt',content:''},
   {name:'夜雨.md',content:'系列：街道故事\n# 夜雨\n\n窗外下起了雨。\n'},
  ];
  expect(await browser.evaluate(`(()=>{
   const slot=document.querySelector('dialog .episode-batch-upload-slot');
   const dataTransfer=new DataTransfer();
   for(const {name,content} of ${JSON.stringify(dropped)})dataTransfer.items.add(new File([content],name));
   const accepted=!slot.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));
   const handled=!slot.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
   return accepted&&handled;
  })()`)).toBe(true);
  await browser.cli('wait','--text','请填写脚本正文。');
  await browser.fill('脚本正文',revised);
  await browser.click('检查重复');
  await browser.cli('wait','--text','请在预览中逐条选择系列或「未分系列」。');
  await browser.cli('select','dialog details:first-of-type select[name=seriesVersionId]','unassigned');
  expect(await browser.evaluate("document.querySelector('dialog details:nth-of-type(2) summary').textContent")).toContain('系列：街道故事');
  await browser.click('检查重复');
  await browser.cli('wait','--text','重复检查完成，可提交创建。');
  await browser.cli('set','viewport','420','820');
  expect(await browser.evaluate("(()=>{const d=document.querySelector('dialog.episode-batch-import');const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()")).toBe(true);
  await browser.capture('narrow-preview');
  browser.dropNextResponse('episode-imports:submit');
  await browser.click('提交创建');
  await browser.cli('wait','--text','提交结果暂未确认，可重试此批。');
  expect(browser.traffic).toContainEqual({command:'episode-imports:submit',status:200,dropped:true});
  await browser.click('重试此批');
  await browser.cli('wait','--text','成功 2');
  await browser.cli('reload');
  await browser.click('批量新建');
  await browser.cli('wait','--text','成功 2');
  await browser.cli('set','viewport','1440','900');
  await browser.capture('recovered-result');
  await browser.cli('click','.episode-batch-results li:first-child button');
  await browser.wait("document.querySelector('.script-studio-badge')?.textContent==='待确认'");
  expect(await browser.evaluate("document.querySelector('textarea[name=script]')?.value")).toBe(revised);
  await browser.cli('reload');
  await browser.wait("document.querySelector('.script-studio-badge')?.textContent==='待确认'");
  expect(await browser.evaluate("document.querySelector('textarea[name=script]')?.value")).toBe(revised);
  await browser.capture('waiting-script');
  await browser.click('关闭生产单详情');
  await browser.click('批量新建');
  await browser.cli('wait','--text','成功 2');
  await browser.click('开始新批次');
  await browser.cli('select','dialog select[name=accountId]',account.body.id);

  await writeFile(txt,'系列：误写的系列\r\n'+revised);
  await browser.cli('upload','dialog input[type=file]',txt,md);
  await browser.cli('wait','--text','当前账号下找不到此系列。');
  await browser.cli('click','dialog details:first-of-type summary');
  await browser.cli('select','dialog details:first-of-type select[name=seriesVersionId]','unassigned');
  await browser.click('检查重复');
  await browser.cli('wait','--text','重复检查完成，可提交创建。');
  expect(await browser.evaluate("document.querySelectorAll('dialog select[name=duplicate]').length")).toBe(2);
  await browser.cli('select','dialog details:nth-of-type(2) select[name=duplicate]','create');
  await browser.click('提交创建');
  await browser.cli('wait','--text','成功 1 · 跳过 1 · 失败 0');
  expect(browser.traffic.some(record=>['start','confirmScriptStudio'].includes(record.command))).toBe(false);
 }catch(error){await browser?.capture('failed').catch(()=>{});throw error;}
 finally{await browser?.close();await f.close();await volume.close();}
},120000);
