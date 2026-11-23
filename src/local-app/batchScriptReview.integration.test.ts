// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {storyBrowser} from './storyBrowser.fixture';
import {csrfFor} from './sessions';

type Fixture=Awaited<ReturnType<typeof productionWorkspaceFixture>>;
async function withBatchOrders(run:(f:Fixture,create:(title:string)=>Promise<string>,accountId:string)=>Promise<void>){
 const volume=await workspaceAudioVolume();
 try{
  const f=await productionWorkspaceFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath},migrations:['db/local/220-episode-batch-import.sql','db/local/223-manual-script-review-drafts.sql']});
  try{
   const account=await f.post('configuration','createAccount',{name:'批量审稿验收',slug:'batch-script-review',timezone:'Asia/Shanghai',policy:{positioning:'生活记录',tone:'自然'}});
   expect(account.status,JSON.stringify(account.body)).toBe(200);
   await run(f,async title=>{
    const result=await f.post('episode-commands','create',{accountId:account.body.id,title});
    expect(result.status,JSON.stringify(result.body)).toBe(200);
    return result.body.id as string;
   },account.body.id);
  }finally{await f.close();}
 }finally{await volume.close();}
}

async function importTextOrder(f:Fixture,accountId:string,title:string,sourceText:string){
 const response=await fetch(f.origin+'/api/local/episode-imports',{
  method:'POST',
  headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},
  body:JSON.stringify({action:'submit',batchId:randomUUID(),accountId,seriesVersionId:null,items:[{itemId:randomUUID(),sourceName:title+'.txt',title,sourceText}]}),
 });
 const result=await response.json();
 expect(response.status,JSON.stringify(result)).toBe(200);
 expect(result.items[0]).toMatchObject({status:'succeeded',episodeId:expect.any(String)});
 return result.items[0].episodeId as string;
}

it.skipIf(process.env.LOOP_BATCH_SCRIPT_ACCEPTANCE!=='1')('reviews the exact saved script, detects a replacement, and advances each approved order independently',async()=>{
 await withBatchOrders(async(f,create,accountId)=>{
   const first=await create('第一张手工单'),second=await create('第二张手工单'),blank=await create('无脚本手工单');
   async function read(id:string,suffix='batch-script-review',token=f.token){
    const response=await fetch(f.origin+'/api/local/episodes/'+id+(suffix?'/'+suffix:''),{headers:{Cookie:'loop_owner_session='+token}});
    return {status:response.status,body:await response.json()};
   }
   const save=(episodeId:string,text:string)=>f.post('episode-commands','saveScriptReviewDraft',{episodeId,text,targetDuration:null});
   const confirm=(episodeId:string,reviewFingerprint:string,token=f.token)=>f.post('episode-commands','confirmReviewedScript',{episodeId,reviewFingerprint},{token});

   expect((await read(blank)).body).toMatchObject({status:'skipped'});
   const saved=await save(first,'画面是旧纸船。');
   expect(saved.status,JSON.stringify(saved.body)).toBe(200);
   expect((await save(second,'画面是山脚的灯。')).status).toBe(200);
   const firstReview=(await read(first)).body,secondReview=(await read(second)).body;
   expect(firstReview).toMatchObject({status:'ready',sourceText:'画面是旧纸船。',plan:{shots:[{visual:'画面是旧纸船。'}]}});
   expect((await read(first,'batch-script-review',f.otherToken)).status).toBe(404);
   expect((await confirm(first,firstReview.reviewFingerprint,f.otherToken)).status).toBe(404);

   expect((await save(first,'纸船换成木船。')).status).toBe(200);
   expect((await confirm(first,firstReview.reviewFingerprint)).body).toMatchObject({status:'failed',requiresReview:true});
   expect((await confirm(second,secondReview.reviewFingerprint)).body).toMatchObject({status:'success'});
   expect((await read(second,'')).body.sections.episode.stage).toBe('script_approved');
   expect((await read(first,'')).body.sections.episode.stage).toBe('waiting_input');
   const replacement=(await read(first)).body;
   expect(replacement.sourceText).toBe('纸船换成木船。');
   expect(replacement.reviewFingerprint).not.toBe(firstReview.reviewFingerprint);
   expect((await confirm(first,replacement.reviewFingerprint)).body).toMatchObject({status:'success'});
   expect((await read(first,'')).body.sections.episode.stage).toBe('script_approved');
   expect((await read(first)).body).toMatchObject({status:'skipped'});
   const imported=await importTextOrder(f,accountId,'文字导入单','导入原稿还写着窗外的雨。');
   const importedReview=(await read(imported)).body;
   expect(importedReview).toMatchObject({status:'ready',sourceText:'导入原稿还写着窗外的雨。'});
   expect((await confirm(imported,importedReview.reviewFingerprint)).body).toMatchObject({status:'success'});
   expect((await read(imported,'')).body.sections.episode.stage).toBe('script_approved');
 });
},120000);

it.skipIf(process.env.LOOP_BATCH_SCRIPT_BROWSER!=='1')('selects across pages, confirms manually created and imported scripts, and clears picks when searching or filtering',async()=>{
 await withBatchOrders(async(f,create,accountId)=>{
  const first=await create('核对单 A0');
  const second=await importTextOrder(f,accountId,'核对单 B0','第一批保留原来的画面。');
  const third=await importTextOrder(f,accountId,'核对单 A9','第二批更换了画面的颜色。');
  for(let index=1;index<=8;index++)await create('核对单 A'+index);
  const save=(episodeId:string,text:string)=>f.post('episode-commands','saveScriptReviewDraft',{episodeId,text,targetDuration:null});
  const browser=await storyBrowser({...f,episode:first},'batch-script-review','核对单 A0');
  try{
   await browser.wait("!!document.querySelector('.script-studio-editor textarea:not([disabled])')");
   await browser.fill('脚本正文','初稿是一个石头屋。\n'+ '后续镜头说明。\n'.repeat(48));
   await browser.click('保存待确认脚本');
   await browser.wait("document.body.innerText.includes('已保存待确认')");
   await browser.cli('open',browser.url.replace(/\?.*/,'?view=episodes&pageSize=10'));
   await browser.wait("!!document.querySelector('.episode-search input')");
   await browser.fill('搜索标题或编号','核对单');
   await browser.click('搜索');
   await browser.wait("document.querySelectorAll('.episode-table tbody tr').length===10");
   await browser.cli('find','role','checkbox','click','--name','全选本页','--exact');
   await browser.wait("document.body.innerText.includes('已选 10 张')");
   await browser.cli('find','role','button','click','--name','第 2 页','--exact');
   await browser.wait("document.querySelectorAll('.episode-table tbody tr').length===1");
   await browser.cli('find','role','checkbox','click','--name','全选本页','--exact');
   await browser.wait("document.body.innerText.includes('已选 11 张')");
   expect(await browser.evaluate(`(()=>{
    const count=document.querySelector('.episode-batch-selection-count[role=status]');
    return count?.textContent==='已选 11 张'&&count.nextElementSibling?.getAttribute('aria-label')==='清空选择';
   })()`)).toBe(true);
   for(const [width,height] of [[420,820],[1357,946]]){
    await browser.cli('set','viewport',String(width),String(height));
    await browser.click('批量操作');
    expect(await browser.evaluate(`(()=>{
     const popover=document.querySelector('.episode-batch-action-popover');
     const menu=popover.querySelector('[role=menu]');
     const box=popover.getBoundingClientRect();
     return box.width===180&&box.left>=0&&box.right<=innerWidth
      &&popover.scrollWidth===popover.clientWidth&&menu.scrollWidth===menu.clientWidth;
    })()`)).toBe(true);
    if(width===420)await browser.cli('press','Escape');
   }
   await browser.cli('find','role','menuitem','click','--name','确认脚本','--exact');
   await browser.wait("!!document.querySelector('dialog[open] input[aria-label=\"通过 核对单 A0\"]')");
   const trigger='button[aria-label="查看 核对单 A0 的脚本"]';
   const preview='.episode-batch-script-preview-panel:popover-open';
   expect(await browser.evaluate("!document.querySelector('dialog[open] .episode-batch-script-item details,.episode-batch-storyboard')")).toBe(true);
   await browser.cli('hover',trigger);
   await browser.wait(`document.querySelector('${preview}')?.innerText.includes('初稿是一个石头屋。')===true`);
   await browser.cli('hover',preview);
   expect(await browser.evaluate(`(()=>{const panel=document.querySelector('${preview}');const box=panel.getBoundingClientRect();return panel.scrollHeight>panel.clientHeight&&box.left>=0&&box.right<=innerWidth;})()`)).toBe(true);
   await browser.cli('press','Escape');
   await browser.wait(`!document.querySelector('${preview}')&&!!document.querySelector('dialog[open]')`);
   await browser.cli('set','viewport','420','820');
   await browser.cli('focus',trigger);
   await browser.cli('press','Enter');
   await browser.wait(`document.activeElement.matches('${preview}')`);
   await browser.cli('press','PageDown');
   await browser.wait(`document.querySelector('${preview}')?.scrollTop>0`);
   expect(await browser.evaluate(`(()=>{const box=document.querySelector('${preview}').getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight;})()`)).toBe(true);
   await browser.cli('press','Escape');
   await browser.wait(`!document.querySelector('${preview}')&&!!document.querySelector('dialog[open]')`);
   await browser.cli('set','viewport','1357','946');
   await browser.cli('find','role','checkbox','click','--name','通过 核对单 A0','--exact');
   await browser.cli('find','role','checkbox','click','--name','通过 核对单 B0','--exact');
   await browser.cli('find','role','checkbox','click','--name','通过 核对单 A9','--exact');
   expect((await save(first,'改稿是一个木头屋。')).status).toBe(200);
   await browser.click('确认勾选脚本');
   await browser.wait("document.querySelector('dialog[open]')?.innerText.includes('待确认脚本已变化，请重新核对。')");
   expect(await browser.evaluate("document.querySelector('dialog .episode-batch-disclosure')?.open")).toBe(false);
   await browser.cli('click','dialog .episode-batch-disclosure summary');
   const outcome=String(await browser.evaluate("document.querySelector('dialog[open]').innerText"));
   expect(outcome).toContain('核对单 B0\n成功');
   expect(outcome).toContain('核对单 A9\n成功');
   expect(outcome).toContain('核对单 A8\n跳过');
   await browser.capture('stale-and-success');
   await browser.click('重新核对失败项');
   await browser.wait(`!!document.querySelector('${trigger}')`);
   await browser.click('查看 核对单 A0 的脚本');
   await browser.wait(`document.querySelector('${preview}')?.innerText.includes('改稿是一个木头屋。')===true`);
   await browser.cli('press','Escape');
   expect(await browser.evaluate("document.querySelector('dialog[open] input[type=checkbox]').checked")).toBe(false);
   await browser.cli('find','role','checkbox','click','--name','通过 核对单 A0','--exact');
   await browser.click('确认勾选脚本');
   await browser.wait("document.querySelector('dialog[open]')?.innerText.includes('核对单 A0\\n成功')");
   const read=async(id:string)=>(await(await fetch(f.origin+'/api/local/episodes/'+id,{headers:{Cookie:'loop_owner_session='+f.token}})).json()).sections.episode.stage;
   expect(await read(first)).toBe('script_approved');
   expect(await read(second)).toBe('script_approved');
   expect(await read(third)).toBe('script_approved');
   expect(browser.traffic.filter(entry=>entry.command==='confirmReviewedScript')).toHaveLength(4);
   await browser.click('关闭');
   await browser.fill('搜索标题或编号','B0');
   await browser.click('搜索');
   await browser.wait("document.querySelector('.episode-table tbody')?.innerText.includes('核对单 B0')");
   expect(await browser.evaluate("!!document.querySelector('.episode-batch-selection-count')")).toBe(false);
   await browser.cli('find','role','checkbox','click','--name','选择 核对单 B0','--exact');
   await browser.wait("document.body.innerText.includes('已选 1 张')");
   await browser.click('清空选择');
   expect(await browser.evaluate("!document.querySelector('.episode-batch-selection-toolbar')")).toBe(true);
   await browser.cli('find','role','checkbox','click','--name','选择 核对单 B0','--exact');
   await browser.cli('find','role','tab','click','--name','已完成','--exact');
   await browser.wait("document.body.innerText.includes('没有符合条件的生产单')");
   expect(await browser.evaluate("!!document.querySelector('.episode-batch-selection-count')")).toBe(false);
  }finally{await browser.close();}
 });
},120000);
