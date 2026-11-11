import subprocess,json,pathlib
base=pathlib.Path(__file__).parent
session='owner-settings-migration-root'
def cmd(*args):
 r=subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr+r.stdout)
 return r.stdout
results=[]
for theme in ['light','dark']:
 cmd('eval',f'document.documentElement.dataset.theme="{theme}"')
 cmd('set','viewport','1440','1000')
 for page in ['个人偏好','通知','登录与安全','日志','文件清理','连接配置','密钥管理']:
  cmd('find','role','button','click','--name',page,'--exact')
  cmd('wait','--fn','document.getAnimations().every(a=>a.playState!=="running")&&!document.querySelector(".owner-settings-main [aria-busy=true],.owner-settings-main .secret-skeleton,.owner-settings-main .owner-preferences-loading")')
  data=json.loads(cmd('a11y','--selector','.owner-settings-dialog','--json'))
  results.append(dict(theme=theme,page=page,counts=data['data']['counts'],violations=data['data']['violations']))
(base/'accessibility-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False))
