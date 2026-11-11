import subprocess,json,pathlib
base=pathlib.Path(__file__).parent
session='owner-settings-migration-root'
def cmd(*args):
 r=subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr+r.stdout)
 return r.stdout
pages=['个人偏好','通知','登录与安全','日志','文件清理','连接配置','密钥管理']
results=[]
for theme in ['light','dark']:
 cmd('eval',f'document.documentElement.dataset.theme="{theme}"')
 for width,height in [(1440,1000),(1024,768),(375,812),(320,640)]:
  cmd('set','viewport',str(width),str(height))
  for idx,page in enumerate(pages):
   cmd('find','role','button','click','--name',page,'--exact')
   cmd('wait','--fn','document.getAnimations().every(a=>a.playState!=="running")&&!document.querySelector(".owner-settings-main [aria-busy=true],.owner-settings-main .secret-skeleton,.owner-settings-main .owner-preferences-loading")')
   state=json.loads(cmd('eval','JSON.stringify((()=>{const d=document.querySelector(".owner-settings-dialog"),m=document.querySelector(".owner-settings-main");return {label:d.getAttribute("aria-label"),dialogs:document.querySelectorAll("[role=dialog]").length,width:d.clientWidth,overflow:d.scrollWidth-d.clientWidth,mainOverflow:m.scrollWidth-m.clientWidth,plaintext:!!document.querySelector("[aria-label=密钥明文]")}})())'))
   # eval returns JSON-string encoded as JSON output
   if isinstance(state,str):state=json.loads(state)
   results.append(dict(theme=theme,viewport=[width,height],page=page,**state))
   cmd('screenshot',str(base/f'{theme}-{width}-{idx}.png'))
(base/'layout-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'scenes':len(results),'failures':[r for r in results if r['overflow']>1 or r['mainOverflow']>1 or r['dialogs']!=1 or r['plaintext']]},ensure_ascii=False))
