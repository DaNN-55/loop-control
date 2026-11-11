import subprocess,json,pathlib
base=pathlib.Path(__file__).parent
session='loop-comments-v2-root'
def cmd(*args):
 r=subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr+r.stdout)
 return r.stdout
results=[]
for theme in ['light','dark']:
 cmd('eval',f'document.documentElement.dataset.theme="{theme}"')
 for width,height in [(1348,953),(375,812),(320,640)]:
  cmd('set','viewport',str(width),str(height))
  for page in ['Preferences','Notifications','Login & security','Logs','File cleanup','Connections','Secrets']:
   cmd('find','role','button','click','--name',page,'--exact')
   cmd('wait','--fn','document.getAnimations().every(a=>a.playState!=="running")&&!document.querySelector(".owner-settings-main [aria-busy=true],.owner-settings-main .secret-skeleton,.owner-settings-main .owner-preferences-loading")')
   out=json.loads(cmd('eval','JSON.stringify((()=>{const d=document.querySelector(".owner-settings-dialog"),m=document.querySelector(".owner-settings-main");let t=[];const w=document.createTreeWalker(d,NodeFilter.SHOW_TEXT);while(w.nextNode()){const n=w.currentNode;if(/[\u3400-\u9fff]/.test(n.textContent)&&n.parentElement.checkVisibility())t.push(n.textContent.trim());}return {label:d.getAttribute("aria-label"),dialogs:document.querySelectorAll("[role=dialog]").length,overflow:d.scrollWidth-d.clientWidth,mainOverflow:m.scrollWidth-m.clientWidth,chinese:[...new Set(t)]}})())'))
   if isinstance(out,str):out=json.loads(out)
   results.append(dict(theme=theme,viewport=[width,height],page=page,**out))
   if page in ['Preferences','Connections','Secrets'] and width in [1348,320]:cmd('screenshot',str(base/f'root-{theme}-{width}-{page.lower()}.png'))
(base/'root-browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'scenes':len(results),'overflow':[r for r in results if r['overflow']>1 or r['mainOverflow']>1],'remainingChinese':sorted({t for r in results for t in r['chinese']})},ensure_ascii=False))
