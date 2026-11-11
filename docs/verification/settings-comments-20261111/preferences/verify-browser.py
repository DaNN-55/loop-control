import subprocess,json,pathlib
base=pathlib.Path(__file__).parent
session='preferences-comments-v2'
def cmd(*args):
 r=subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr+r.stdout)
 return r.stdout
results=[]
for language in ['zh','en']:
 for theme in ['light','dark']:
  for width,height in [(1348,953),(375,812),(320,640)]:
   cmd('set','viewport',str(width),str(height))
   cmd('open',f'http://127.0.0.1:5212/__preferences?language={language}&theme={theme}')
   cmd('wait','--fn','!!document.querySelector("input")&&!document.querySelector(".owner-preferences-loading")&&document.getAnimations().every(a=>a.playState!=="running")')
   for page in ['profile','storage']:
    if page=='storage':cmd('find','role','tab','click','--name','Storage locations' if language=='en' else '存储位置','--exact')
    cmd('wait','--fn','!document.querySelector(".owner-settings-main [aria-busy=true]")&&document.getAnimations().every(a=>a.playState!=="running")')
    result=json.loads(cmd('eval','JSON.stringify((()=>{const d=document.querySelector(".owner-settings-dialog"),p=document.querySelector(".owner-profile-fields"),n=p?.children[0].getBoundingClientRect(),a=p?.children[1].getBoundingClientRect();return {overflow:d.scrollWidth-d.clientWidth,mainOverflow:document.querySelector(".owner-settings-main").scrollWidth-document.querySelector(".owner-settings-main").clientWidth,profileColumns:n&&a?Math.abs(n.top-a.top)<2&&a.left>n.left:false,userName:document.querySelector("input[aria-label=\\\"Display name\\\"],input[aria-label=显示名称]")?.value}})())'))
    if isinstance(result,str):result=json.loads(result)
    results.append(dict(language=language,theme=theme,width=width,page=page,**result))
    cmd('screenshot',str(base/f'{language}-{theme}-{width}-{page}.png'))
(base/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'scenes':len(results),'failures':[r for r in results if r['overflow']>1 or r['mainOverflow']>1 or r['userName']!='保留中文名称']},ensure_ascii=False))
