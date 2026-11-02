// @vitest-environment node
import {it,expect} from 'vitest';
import {storyE2eFixture} from './storyE2e.fixture';
import {storyBrowser} from './storyBrowser.fixture';
const enabled=process.env.LOOP_STORY_E2E==='1';
it.skipIf(!enabled)('real page keeps login and production states honest during delayed reads and recovers a failed read without writes',async()=>{
 const f=await storyE2eFixture();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined;
 const release:Array<()=>void>=[];
 try{
  browser=await storyBrowser(f,'loading-recovery');
  const session=browser.holdRead('session'),catalog=browser.holdRead('catalog'),workspace=browser.holdRead('workspace');release.push(session,catalog,workspace);
  await browser.cli('reload');await browser.cli('wait','--text','正在确认登录状态');
  expect(await browser.evaluate("!!document.querySelector('input[type=password]')")).toBe(false);await browser.capture('session-loading');
  session();await browser.cli('wait','--text','正在读取工作区');
  expect(await browser.evaluate("!!document.querySelector('input[type=password]')")).toBe(false);catalog();
  await browser.cli('wait','--text','正在读取制作流程');
  const loading=String(await browser.evaluate('document.body.innerText'));expect(loading).not.toContain('没有可用');expect(loading).not.toContain('已交付');await browser.capture('workspace-loading');workspace();
  await browser.cli('wait','--text','分镜台');
  const allow=browser.failReads('workspace');release.push(allow);await browser.cli('reload');await browser.cli('wait','--text','测试网关：暂时无法读取');
  expect(await browser.evaluate("!!document.querySelector('input[type=password]')")).toBe(false);
  await browser.capture('read-failed');const writes=browser.traffic.filter(r=>r.command!=='read'&&r.command!=='login').length;
  allow();await browser.click('重新读取制作流程');await browser.cli('wait','--text','分镜台');
  expect(browser.traffic.filter(r=>r.command!=='read'&&r.command!=='login')).toHaveLength(writes);await browser.capture('recovered');
 }catch(error){await browser?.capture('failed');throw error;}
 finally{release.forEach(r=>r());await browser?.close();await f.close();}
},120000);
