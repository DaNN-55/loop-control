// @vitest-environment node
import {expect,it} from 'vitest';
import {lstat,realpath,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {storyBrowser} from './storyBrowser.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';

it.skipIf(process.env.LOOP_BATCH_COLLECTION_BROWSER!=='1')('catalog changes a selected batch and retries only failed moves and folder opens',async()=>{
 if(!process.env.LOOP_TEST_CONTEXT_MODULE||!process.env.LOOP_STORY_EVIDENCE)throw Error('Explicit isolated test context and evidence directory required');
 const volume=await workspaceAudioVolume(),opened:string[]=[];
 const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,async openDirectory(path){opened.push(await realpath(path));}}}).catch(async error=>{await volume.close();throw error;});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const send=async(endpoint:string,command:string,data:Record<string,unknown>)=>{
   const result=await f.post(endpoint,command,data);
   expect(result.status,JSON.stringify(result.body)).toBe(200);
   return result.body;
  };
  const account=await send('configuration','createAccount',{name:'批量收纳账号',slug:'browser-collection',timezone:'Asia/Shanghai',policy:{}});
  const source=await send('configuration','createSeries',{accountId:account.id,name:'出发系列',rules:{positioning:'冻结规则'}});
  const target=await send('configuration','createSeries',{accountId:account.id,name:'目标系列',rules:{positioning:'目标规则'}});
  const ready=await send('episode-commands','create',{accountId:account.id,title:'完好目录',seriesVersionId:source.id});
  const missing=await send('episode-commands','create',{accountId:account.id,title:'缺失目录',seriesVersionId:source.id});
  const already=await send('episode-commands','create',{accountId:account.id,title:'已在目标',seriesVersionId:target.id});
  const read=(episodeId:string)=>send('account-commands','readEpisodeCollection',{episodeId});
  const readyBefore=await read(ready.id),missingBefore=await read(missing.id);
  await writeFile(join(readyBefore.directoryPath,'文件.txt'),'隔离验收文件');
  const page=browser=await storyBrowser(f,'batch-collection','隔离 Studio153 验收');
  const listUrl=page.url.split('?')[0]+'?accountId='+account.id;
  await page.cli('open',listUrl);
  const check=(title:string)=>page.cli('find','role','checkbox','click','--name','选择 '+title,'--exact');
  const outcome=(title:string,status:string)=>page.wait(`Array.from(document.querySelectorAll('dialog .episode-batch-results li')).some(row=>row.querySelector('strong')?.textContent===${JSON.stringify(title)}&&row.dataset.status===${JSON.stringify(status)})`);
  await page.cli('wait','--text','完好目录');
  for(const title of ['完好目录','缺失目录','已在目标'])await check(title);
  await page.click('批量调整系列');
  const option=(await page.snapshot()).split('\n').find(line=>line.includes('combobox "目标系列"'))?.match(/ref=(e\d+)/)?.[1];
  expect(option).toBeTruthy();
  await page.cli('select','@'+option,target.series_id);
  await rename(missingBefore.directoryPath,missingBefore.directoryPath+'.offline');
  await page.click('确认调整系列');
  await outcome('完好目录','success');await outcome('缺失目录','failed');await outcome('已在目标','skipped');
  expect((await read(ready.id)).collection.seriesId).toBe(target.series_id);
  const moves=()=>page.traffic.filter(item=>item.command==='moveEpisodeCollection');
  expect(moves()).toHaveLength(3);
  await rename(missingBefore.directoryPath+'.offline',missingBefore.directoryPath);
  await page.click('只重试失败项');await outcome('缺失目录','success');
  expect(moves()).toHaveLength(4);
  await page.capture('moves');await page.click('关闭');
  await page.click('查看文件夹');
  const readyAfter=await read(ready.id),missingAfter=await read(missing.id),alreadyAfter=await read(already.id);
  await page.wait(`document.querySelector('dialog').textContent.includes(${JSON.stringify(readyAfter.directoryPath)})`);
  await page.cli('set','viewport','390','820');
  expect(await page.evaluate("(()=>{const dialog=document.querySelector('dialog[open]');const bounds=dialog.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&dialog.scrollWidth<=dialog.clientWidth;})()")).toBe(true);
  const open=(title:string)=>page.click('打开文件夹 · '+title);
  await open('完好目录');await outcome('完好目录','success');
  await rename(missingAfter.directoryPath,missingAfter.directoryPath+'.offline');
  await page.click('打开可用文件夹');await outcome('缺失目录','failed');await outcome('已在目标','success');
  expect(opened).toEqual([readyAfter.directoryPath,alreadyAfter.directoryPath]);
  await expect(lstat(missingAfter.directoryPath)).rejects.toMatchObject({code:'ENOENT'});
  await rename(missingAfter.directoryPath+'.offline',missingAfter.directoryPath);
  await page.click('只重试失败项');await outcome('缺失目录','success');
  expect(opened).toEqual([readyAfter.directoryPath,alreadyAfter.directoryPath,missingAfter.directoryPath]);
  await page.capture('folders');await page.click('关闭');
 }catch(error){await browser?.capture('failed').catch(()=>{});throw error;}
 finally{await browser?.close();await f.close();await volume.close();}
},180000);
