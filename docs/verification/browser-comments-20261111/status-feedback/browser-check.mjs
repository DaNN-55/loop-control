import{execFileSync}from'node:child_process';import{writeFileSync}from'node:fs';import assert from'node:assert/strict';
const cli=(...a)=>{const r=JSON.parse(execFileSync('agent-browser',['--session','lc-status-feedback','--json',...a],{encoding:'utf8',maxBuffer:3e6}));assert(r.success,r.error);return r.data;};const ev=s=>cli('eval',s).result,click=n=>cli('find','role','button','click','--name',n,'--exact'),wait=s=>cli('wait','--fn',s);
cli('open','http://127.0.0.1:5221/docs/verification/browser-comments-20261111/status-feedback/fixture/index.html');
const evidence=[];
for(const width of [1440,375])for(const theme of ['light','dark']){
 cli('set','viewport',String(width),'1000');if(ev('document.documentElement.dataset.theme')!==theme)click('切换主题');click('工作台示例');
 wait('document.querySelector(".work-blocker-reason")?.textContent.includes("口播结果待核对")');assert.equal(ev('document.documentElement.scrollWidth<=innerWidth'),true);assert(ev('document.querySelector(".work-next-step").textContent.includes("供应商请求结果未知")'));
 cli('screenshot',`docs/verification/browser-comments-20261111/status-feedback/status-${width}-${theme}.png`);
 click('操作错误示例');wait('!!Array.from(document.querySelectorAll("button")).find(e=>e.textContent==="进入剪辑工作台")');const before=ev('window.feedbackEvidence.commands.length');click('进入剪辑工作台');wait('!!document.querySelector(".workspace-uncertain-operation")');
 assert(ev('document.querySelector(".workspace-uncertain-operation").textContent.includes("打开剪辑工作台结果暂未确认")'));
 const requests=ev('window.feedbackEvidence.requests.length');click('重新读取已保存工程');wait('document.querySelector(".workspace-uncertain-operation")?.textContent.includes("原操作是否完成仍未确认")');
 assert.equal(ev('window.feedbackEvidence.commands.length'),before+1);const delta=ev(`window.feedbackEvidence.requests.slice(${requests})`);assert.equal(delta.length,1);assert(delta.every(r=>r.method==='GET'&&r.url.endsWith('/workspace')));assert.equal(ev('document.documentElement.scrollWidth<=innerWidth'),true);
 cli('screenshot',`docs/verification/browser-comments-20261111/status-feedback/error-${width}-${theme}.png`);evidence.push({width,theme,commandsDuringRecovery:0,requests:delta});
}
assert.deepEqual(cli('errors').errors,[]);writeFileSync('docs/verification/browser-comments-20261111/status-feedback/browser-results.json',JSON.stringify({passed:4,evidence},null,2)+'\n');console.log('4 viewport/theme scenarios passed; operation checks issue one GET and no write/replay.');
