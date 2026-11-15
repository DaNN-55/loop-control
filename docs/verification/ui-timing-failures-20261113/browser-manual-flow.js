(async()=>{
 const wait=async check=>{const until=performance.now()+5000;do{await new Promise(resolve=>requestAnimationFrame(resolve));if(check())return;}while(performance.now()<until);throw Error('Expected public UI state did not arrive');};
 const button=name=>[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===name||x.textContent===name);
 const state=()=>({confirmKeys:[...window.timing.trace.confirmKeys],readbackKeys:[...window.timing.trace.readbackKeys],saveKeys:[...window.timing.trace.saveKeys],adoptDisabled:button('采用')?.disabled,pendingKeys:Object.keys(sessionStorage).filter(k=>k.startsWith('loop.local.pending.')),registration:!!document.querySelector('section[aria-label="人工口播登记"]')});
 const stages=[];await wait(()=>!!button('拖入口播文件')&&!button('拖入口播文件').disabled);
 const data=new DataTransfer();data.setData('application/x-loop-workspace-material','first');button('拖入口播文件').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));
 await wait(()=>document.body.textContent.includes('本次操作结果暂未确认'));stages.push({phase:'initial-unknown',...state()});
 button('关闭口播测试').click();await wait(()=>!document.querySelector('section[aria-label="逐镜口播"]'));button('重开口播测试').click();await wait(()=>!!button('重试加入候选'));
 button('重试加入候选').click();await wait(()=>window.timing.trace.requests.filter(r=>r.path.endsWith('/workspace')).length===2&&button('采用')?.disabled);
 stages.push({phase:'workspace-held',...state()});if(state().readbackKeys.length!==1)throw Error('Receipt read before current workspace');
 window.timing.releaseWorkspace();await wait(()=>state().readbackKeys.length===2);stages.push({phase:'receipt-held',...state()});
 if(!state().adoptDisabled||!state().registration||state().confirmKeys.length!==1||!state().pendingKeys.some(k=>k.endsWith('.uncertain')))throw Error('Recovery settled before receipt');
 window.timing.releaseReceipt();await wait(()=>!state().registration&&state().pendingKeys.length===0&&!state().adoptDisabled);stages.push({phase:'committed',...state()});
 const last=state();if(last.confirmKeys.length!==1||last.saveKeys.length!==1||last.readbackKeys.length!==2||last.readbackKeys.some(k=>k!==last.confirmKeys[0]))throw Error('Recovery replayed frozen mutation');
 return JSON.stringify({passed:true,stages,trace:window.timing.trace});
})()
