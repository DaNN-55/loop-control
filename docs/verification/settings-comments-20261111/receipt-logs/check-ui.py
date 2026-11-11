import subprocess,json,pathlib
base=pathlib.Path(__file__).parent
session='receipt-logs-v2'
def run(*args):
 r=subprocess.run(['agent-browser','--session',session,*args],text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr+r.stdout)
 return r.stdout
checks=[]
for lang in ['zh','en']:
 for theme in ['light','dark']:
  for width,height in [(1440,1000),(375,812),(320,640)]:
   run('set','viewport',str(width),str(height))
   for page in ['logs','system']:
    run('open',f'http://127.0.0.1:5214/__receipt-ui?lang={lang}&theme={theme}&page={page}')
    if page=='logs':run('wait','--text','Showing 2 records' if lang=='en' else '显示 2 条记录')
    else:
     run('wait','.status-drawer-drawer');run('find','text','Resources' if lang=='en' else '资源状态','click','--exact')
    run('wait','--fn','document.getAnimations().every(a=>a.playState!=="running")')
    state=json.loads(run('eval','JSON.stringify((()=>{const p=document.querySelector(".runtime-logs-dialog,.status-drawer-drawer");return {pageOverflow:document.documentElement.scrollWidth>innerWidth,panelOverflow:p.scrollWidth>p.clientWidth,rings:document.querySelectorAll(".status-drawer-resource-ring").length}})())'))
    if isinstance(state,str):state=json.loads(state)
    checks.append(dict(lang=lang,theme=theme,viewport=[width,height],page=page,**state))
    if lang=='en' and width in [1440,320]:run('screenshot',str(base/f'{page}-{lang}-{theme}-{width}.png'))
(base/'ui-results.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
print(json.dumps({'scenes':len(checks),'failures':[c for c in checks if c['pageOverflow'] or c['panelOverflow'] or c['page']=='system' and c['rings']!=4]}))
