import subprocess,json,pathlib
base=pathlib.Path(__file__).parent
session='settings-review-v2'
def cmd(*args):
 p=subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True)
 if p.returncode: raise RuntimeError(p.stderr+p.stdout)
 return p.stdout
results=[]
for theme in ['light','dark']:
 for width,height in [(1348,953),(768,900),(375,812),(320,640)]:
  cmd('set','viewport',str(width),str(height))
  for page in ['connections','secrets','recycle']:
   cmd('open',f'http://127.0.0.1:5210/src/local-app/settings-review-v2.prototype.html?page={page}&variant=balanced&theme={theme}')
   cmd('wait','--fn','!!document.querySelector(".sr2-window")')
   state=json.loads(cmd('eval','JSON.stringify((()=>{const d=document.querySelector(".sr2-window"),m=document.querySelector(".sr2-main");return {width:d.clientWidth,overflow:d.scrollWidth-d.clientWidth,mainOverflow:m.scrollWidth-m.clientWidth,dialogs:document.querySelectorAll("[role=dialog]").length}})())'))
   if isinstance(state,str):state=json.loads(state)
   results.append(dict(theme=theme,viewportWidth=width,page=page,**state))
   cmd('screenshot',str(base/f'{page}-{width}-{theme}.png'))
for variant in ['compact','spacious']:
 cmd('set','viewport','1348','953')
 cmd('open',f'http://127.0.0.1:5210/src/local-app/settings-review-v2.prototype.html?variant={variant}')
 cmd('wait','--fn','!!document.querySelector(".sr2-window")')
 cmd('screenshot',str(base/f'connections-{variant}-light.png'))
(base/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'scenes':len(results),'failures':[item for item in results if item['overflow']>1 or item['mainOverflow']>1 or item['dialogs']!=1]},ensure_ascii=False))
