import subprocess,json,pathlib
base=pathlib.Path(__file__).parent
session='preferences-comments-v2'
def cmd(*args):
 r=subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr+r.stdout)
 return r.stdout
results=[]
for language in ['zh','en']:
 for width,height,theme in [(1348,953,'light'),(320,640,'dark')]:
  cmd('set','viewport',str(width),str(height));cmd('open',f'http://127.0.0.1:5212/__preferences?language={language}&theme={theme}')
  cmd('wait','--fn','!!document.querySelector("input")&&document.getAnimations().every(a=>a.playState!=="running")')
  for page in ['profile','storage']:
   if page=='storage':cmd('find','role','tab','click','--name','Storage locations' if language=='en' else '存储位置','--exact')
   cmd('wait','--fn','document.getAnimations().every(a=>a.playState!=="running")')
   a=json.loads(cmd('a11y','--selector','.owner-settings-dialog','--json'))['data']
   results.append(dict(language=language,theme=theme,width=width,page=page,counts=a['counts'],violations=a['violations']))
(base/'a11y-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps([r for r in results if r['counts']['violations']],ensure_ascii=False))
