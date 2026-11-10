(async()=>{
 const rows=[
  ['no-export','尚未导出','尚未开始',null],
  ['checks-failed','检查未通过','待确认',true],
  ['blocked','有待处理问题','待确认',true],
  ['await-confirmation','待确认成片与字幕','待确认',false],
  ['confirmed','成片已确认','可准备',null],
  ['outdated','需重新导出','待确认',true],
  ['stale','需重新导出','待确认',true],
  ['delivery-ready','正在准备交付','正在准备',null],
  ['delivery-running','正在准备交付','正在准备',null],
  ['delivery-failed','成片已确认','交付失败',null],
  ['delivery-unverified','交付文件需核验','需核验',null],
  ['historical-and-latest-failed','交付已完成','交付失败',null],
  ['verified-history','交付已完成','验证完成',true],
 ];
 const pause=()=>new Promise(resolve=>setTimeout(resolve,60));
 const button=name=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===name);
 const results=[];
 for(const [name,review,delivery,confirmDisabled] of rows){
  const select=document.querySelector('[aria-label="核对状态"]');select.value=name;select.dispatchEvent(new Event('change',{bubbles:true}));
  for(let attempt=0;attempt<40;attempt++){
   await pause();if(select.value===name&&document.querySelector('.workspace-compact-heading [role=status]')?.textContent===review)break;
   if(attempt===39)throw Error('State did not load: '+name);
  }
  const actualReview=document.querySelector('.workspace-compact-heading [role=status]').textContent;
  const actualDelivery=document.querySelector('[aria-label="交付包"] .workspace-review-heading span').textContent;
  const confirm=button('确认成片与字幕');
  if(actualReview!==review||actualDelivery!==delivery||(confirmDisabled===null?!!confirm:!confirm||confirm.disabled!==confirmDisabled))throw Error('State mismatch: '+name);
  if(name==='stale'&&!button('重新导出视频')?.disabled)throw Error('Stale export became writable');
  if(['delivery-unverified','verified-history','historical-and-latest-failed'].includes(name)&&button('重新导出视频'))throw Error('Historical completion lost export restriction');
  if(['delivery-failed','historical-and-latest-failed'].includes(name)){
   const retry=document.querySelector('[aria-label="重试原交付"]');if(!retry||retry.disabled)throw Error('Original delivery retry needs a new draft');
  }
  results.push({name,review:actualReview,delivery:actualDelivery,confirmDisabled,passed:true});
 }
 const video=document.querySelector('a.workspace-download-primary'),archive=document.querySelector('[aria-label="下载全部交付文件（ZIP）"]');
 const response=await fetch(video.href),bytes=await response.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
 if(!response.ok||new URL(video.href).searchParams.get('path')!=='delivery/history-final.mp4'||new URL(video.href).searchParams.get('sha256')!==digest)throw Error('Historical video identity changed');
 const zip=await fetch(archive.href),zipBytes=new Uint8Array(await zip.arrayBuffer());if(!zip.ok||zipBytes[0]!==80||zipBytes[1]!==75||new URL(archive.href).searchParams.get('delivery')!=='verified-history')throw Error('Historical archive identity changed');
 const stats=await(await fetch('/__fixture-stats')).json();if(stats.calls.length)throw Error('State inspection sent a business command');
 return{states:results,historicalVideo:{bytes:bytes.byteLength,sha256:digest,passed:true},historicalArchive:{bytes:zipBytes.length,passed:true},commandsBeforeExplicitAction:stats.calls.length};
})()
