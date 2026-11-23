// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {storyBrowser} from './storyBrowser.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';

it.skipIf(process.env.LOOP_BATCH_LIFECYCLE_BROWSER!=='1')('renames across pages and processes mixed archive states with retry and original files intact',async()=>{
 if(!process.env.LOOP_TEST_CONTEXT_MODULE||!process.env.LOOP_STORY_EVIDENCE)throw Error('Explicit isolated test context and evidence directory required');
 const volume=await workspaceAudioVolume();
 const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath}}).catch(async error=>{await volume.close();throw error;});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const account=await f.post('configuration','createAccount',{name:'批量管理验收',slug:'batch-lifecycle-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});
  expect(account.status,JSON.stringify(account.body)).toBe(200);
  const titles=Array.from({length:10},(_,i)=>'原素材 '+(i+1));
  const ids=new Map([['隔离 Studio153 验收',f.episode]]);
  for(const title of titles){
   const result=await f.post('episode-commands','create',{accountId:account.body.id,title});
   expect(result.status,JSON.stringify(result.body)).toBe(200);
   ids.set(title,result.body.id);
  }
  const first=titles[9],second='隔离 Studio153 验收',other=titles[8];
  const episode=async(title:string)=>{
   const response=await fetch(f.origin+'/api/local/episodes/'+ids.get(title),{headers:{Cookie:'loop_owner_session='+f.token}});
   expect(response.status).toBe(200);
   return (await response.json()).sections;
  };
  const content='真实生产目录内容';
  const directories=await Promise.all([first,second].map(async title=>{
   const path=(await episode(title)).localDirectoryPath,probe=join(path,'本地保留.txt');
   await writeFile(probe,content);
   const {dev,ino}=await lstat(path);
   return {title,path,probe,dev,ino};
  }));

  const page=browser=await storyBrowser(f,'batch-lifecycle','隔离 Studio153 验收');
  const listUrl=page.url.split('?')[0]+'?pageSize=10';
  const check=(title:string)=>page.cli('find','role','checkbox','click','--name','选择 '+title,'--exact');
  const row=(title:string)=>page.wait(`Array.from(document.querySelectorAll('.episode-table tbody tr')).some(row=>row.textContent.includes(${JSON.stringify(title)}))`);
  const outcome=(title:string,status:string)=>page.wait(`Array.from(document.querySelectorAll('dialog .episode-batch-results li')).some(row=>row.querySelector('strong')?.textContent===${JSON.stringify(title)} && row.dataset.status===${JSON.stringify(status)})`);
  const requests=()=>page.traffic.filter(request=>request.command==='applyEpisodeBatchItem');
  await page.cli('open',listUrl);await row(first);await check(first);
  await page.click('下一页');await row(second);await check(second);
  await page.click('批量操作');await page.cli('find','role','menuitem','click','--name','改名','--exact');
  await page.fill('添加前缀','批-');await page.fill('添加后缀','-交付');
  await page.fill('查找文本','原');await page.fill('替换为','$&');
  await page.click('预览新标题');
  const value=(index:number)=>page.evaluate(`document.querySelectorAll('dialog input[name=newTitle]')[${index}]?.value`);
  expect(await value(0)).toBe('批-$&素材 10-交付');
  expect(await value(1)).toBe('批-隔离 Studio153 验收-交付');
  await page.fill('新标题 · '+second,'手改/标题');
  await page.cli('set','viewport','390','820');
  expect(await page.evaluate("(()=>{const dialog=document.querySelector('dialog[open]');const bounds=dialog.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&dialog.scrollWidth<=dialog.clientWidth;})()")).toBe(true);
  await page.capture('rename-preview');
  page.interruptNextRequest('applyEpisodeBatchItem');
  await page.click('确认改名');
  await outcome(first,'failed');await outcome(second,'success');
  expect(requests()).toHaveLength(2);
  expect((await episode(first)).episode.title).toBe(first);
  expect((await episode(second)).episode.title).toBe('手改/标题');
  await page.click('只重试失败项');await outcome(first,'success');
  expect(requests()).toHaveLength(3);
  expect((await episode(first)).episode.title).toBe('批-$&素材 10-交付');
  await page.click('关闭');

  const archiveOne=await f.post('episode-lifecycle','archiveEpisode',{episodeId:ids.get(second),archived:true});
  expect(archiveOne.status).toBe(200);
  await page.cli('open',listUrl+'&visibility=all');
  await row('手改/标题');await check('批-$&素材 10-交付');await check('手改/标题');
  await page.click('批量操作');await page.cli('find','role','menuitem','click','--name','归档','--exact');
  page.dropNextResponse('applyEpisodeBatchItem');
  await page.click('确认归档');
  await outcome('手改/标题','skipped');await outcome('批-$&素材 10-交付','success');
  expect(requests()).toHaveLength(5);
  expect(requests()[3]).toMatchObject({status:200,dropped:true});
  await page.capture('archive-results');await page.click('关闭');
  await page.cli('open',listUrl+'&visibility=archived');
  await row('手改/标题');await row('批-$&素材 10-交付');
  await page.cli('open',listUrl+'&visibility=all');
  await row(other);await check(other);await check('手改/标题');await check('批-$&素材 10-交付');
  await page.click('批量操作');await page.cli('find','role','menuitem','click','--name','取消归档','--exact');await page.click('确认取消归档');
  await outcome(other,'skipped');await outcome('手改/标题','success');await outcome('批-$&素材 10-交付','success');
  await page.capture('unarchive-results');await page.click('关闭');
  await page.cli('open',listUrl);await row('手改/标题');await row('批-$&素材 10-交付');

  for(const {title,path,probe,dev,ino} of directories){
   const snapshot=await episode(title),identity=await lstat(path);
   expect(snapshot.localDirectoryPath).toBe(path);
   expect(snapshot.episode.archived_at).toBeNull();
   expect([identity.dev,identity.ino]).toEqual([dev,ino]);
   expect(await readFile(probe,'utf8')).toBe(content);
  }
 }catch(error){await browser?.capture('failed').catch(()=>{});throw error;}
 finally{await browser?.close();await f.close();await volume.close();}
},180000);
