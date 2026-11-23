// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {defaultShotCaptionContract} from '../shotCaptions';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {storyBrowser} from './storyBrowser.fixture';

it.skipIf(process.env.LOOP_BATCH_EXPORT_BROWSER!=='1')('plays exported MP4s from an import batch, submits only approved orders and retries only failures',async()=>{
 const volume=await workspaceAudioVolume();
 const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,wake(){}},migrations:['db/current/220-episode-batch-import.sql']}).catch(async cause=>{await volume.close();throw cause;});
 let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 try{
  const account=await f.post('configuration','createAccount',{name:'批量审片验收',slug:'export-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});
  expect(account.status,JSON.stringify(account.body)).toBe(200);
  const orders=['审片甲','审片乙','审片丙','审片丁'];
  const files=orders.map(title=>join(f.root,title+'.txt'));
  for(const [index,file] of files.entries())await writeFile(file,`隔离成片 ${orders[index]} 的一张画面。`);
  const page=browser=await storyBrowser(f,'batch-export-review','隔离 Studio153 验收');
  await page.click('关闭生产单详情');await page.click('批量新建');
  await page.cli('select','dialog select[name=accountId]',account.body.id);
  await page.cli('upload','dialog input[name=scripts]',...files);
  await page.click('检查重复');await page.cli('wait','--text','重复检查完成，可提交创建。');
  await page.click('提交创建');await page.cli('wait','--text','成功 4');
  await page.click('查看本批');
  const get=async(path:string)=>{
   const response=await fetch(f.origin+'/api/local/'+path,{headers:{Cookie:'loop_owner_session='+f.token}});
   expect(response.status).toBe(200);
   return response.json();
  };
  const {batches:[imported]}=await get('episode-imports');
  const receipts=(await get('episode-imports/'+imported.batchId)).items;
  expect(receipts).toHaveLength(4);
  const setup=async(title:string)=>{
   const episodeId=receipts.find((item:{title:string})=>item.title===title).episodeId as string;
   const cmd=async(command:string,data:Record<string,unknown>={})=>{
    const response=await f.post('episode-commands',command,{episodeId,...data});
    expect(response.status,JSON.stringify(response.body)).toBe(200);
    return response.body;
   };
   const script=await cmd('confirmScriptStudio',{expectedScriptRevisionId:null,text:`隔离成片 ${title} 的一张画面。`,targetDuration:null,reason:''});
   await cmd('start');
   let workspace=await cmd('prepareWorkspace',{expectedScriptRevisionId:script.id});
   const edit=async(command:string,data:Record<string,unknown>={})=>{
    workspace=await cmd(command,{workspaceId:workspace.id,expectedRevision:workspace.revision,...data});
    return workspace;
   };
   const imageBytes=await readFile(workspaceTestMedia('still-striped.png'));
   const image=await cmd('importMaterial',{sourceKind:'file',sourcePath:'still-striped.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:imageBytes.toString('base64')});
   const root=(await get('episodes/'+episodeId)).sections.localAssetRoot;
   const project=JSON.parse(await readFile(join(root,workspace.project.relativePath),'utf8'));
   for(const clip of workspace.clips){
    const timeline=project.timelines.find((timeline:{items:Array<{id:string}>})=>timeline.items.some(item=>item.id===clip.itemId));
    const item=timeline.items.find((item:{id:string})=>item.id===clip.itemId);
    await edit('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.id,usage:'still',durationSeconds:item.durationInFrames/timeline.fps,fit:'contain',focusX:0,focusY:0});
    await edit('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
   }
   await edit('exportWorkspace');
   expect(workspace.exports[0].status,JSON.stringify(workspace.exports[0].checks)).toBe('ready');
   return {title,episodeId,edit,imagePath:join(root,image.storage_path),imageBytes};
  };
  const first=await setup(orders[0]),second=await setup(orders[1]),needsChange=await setup(orders[2]),retry=await setup(orders[3]);
  await page.cli('select','select[name=batchStage]','export_review');
  await page.wait("document.querySelectorAll('.episode-table tbody tr').length===4");
  await page.cli('find','role','checkbox','click','--name','全选本页','--exact');
  await page.click('批量确认成片');
  const review=async(title:string,decision:'通过'|'待修改')=>{
   await page.click('预览 '+title);
   const player="document.querySelector('dialog video')";
   await page.wait(`${player}?.readyState>=2 && ${player}.videoWidth>0`);
   await page.evaluate(`${player}.play().then(()=>true)`);
   await page.wait(`${player}.currentTime>0.05`);
   await page.cli('find','role','radio','click','--name',decision+' '+title,'--exact');
  };
  await review(first.title,'通过');
  await review(second.title,'通过');
  await review(needsChange.title,'待修改');
  await review(retry.title,'通过');
  await page.cli('set','viewport','420','820');
  expect(await page.evaluate("(()=>{const dialog=document.querySelector('dialog[open]');const bounds=dialog.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&dialog.scrollWidth<=dialog.clientWidth;})()")).toBe(true);
  await page.capture('playing-mp4');
  await first.edit('exportWorkspace');
  await writeFile(retry.imagePath,Buffer.alloc(retry.imageBytes.length,7));
  await page.click('提交通过项');
  const waitForOutcome=(title:string,outcome:string)=>page.wait(`Array.from(document.querySelectorAll('dialog .episode-batch-results li')).some(row=>row.querySelector('strong')?.textContent===${JSON.stringify(title)} && row.dataset.status===${JSON.stringify(outcome)})`);
  await waitForOutcome(first.title,'failed');await waitForOutcome(second.title,'success');
  await waitForOutcome(needsChange.title,'skipped');await waitForOutcome(retry.title,'failed');
  expect(page.traffic.filter(entry=>entry.command==='confirmReviewedExport')).toHaveLength(3);
  await page.capture('partial-results');
  await writeFile(retry.imagePath,retry.imageBytes);
  await page.click('只重试失败项');
  await waitForOutcome(retry.title,'success');
  expect(page.traffic.filter(entry=>entry.command==='confirmReviewedExport')).toHaveLength(4);
  await page.click('重新核对失败项');
  expect(await page.evaluate("document.querySelectorAll('dialog input[type=radio]:checked').length")).toBe(0);
  await review(first.title,'通过');await page.click('提交通过项');await waitForOutcome(first.title,'success');
  expect(page.traffic.filter(entry=>entry.command==='confirmReviewedExport')).toHaveLength(5);
  expect(page.traffic.some(entry=>entry.command==='exportWorkspace')).toBe(false);
  await page.capture('retry-results');

  const state=async(id:string)=>(await get('episodes/'+id+'/workspace')).workspace;
  for(const order of [first,second,retry]){
   const workspace=await state(order.episodeId);
   expect(workspace.exports[0].confirmed).toBe(true);
   expect(workspace.deliveries).toHaveLength(1);
  }
  expect((await state(needsChange.episodeId)).exports[0].confirmed).toBe(false);
  await page.click('关闭');
  await page.wait("document.querySelectorAll('.episode-table tbody tr').length===1");
  await page.click(needsChange.title);await page.click('确认并完成');
  await expect.poll(()=>page.traffic.some(entry=>entry.command==='completeWorkspaceExport'&&entry.status===200)).toBe(true);
  expect((await state(needsChange.episodeId)).exports[0].confirmed).toBe(true);
 }catch(error){await browser?.capture('failed').catch(()=>{});throw error;}
 finally{await browser?.close();await f.close();await volume.close();}
},180000);
