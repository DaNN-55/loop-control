import subprocess,json,pathlib
root=pathlib.Path(__file__).resolve().parent
base='http://127.0.0.1:5210/docs/verification/recycle-bin-migration-20261111/browser/index.html'
def run(*args):
 return subprocess.run(['agent-browser','--session','recycle-compact-review',*args],capture_output=True,text=True,check=True).stdout.strip()
results=[]
for width,height in [(1340,953),(390,844)]:
 run('set','viewport',str(width),str(height))
 for lang in ['zh','en']:
  for theme in ['light','dark']:
   run('open',base+'?lang='+lang+'&theme='+theme)
   raw=run('eval','JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,height:document.querySelector(".recycle-bin-settings").getBoundingClientRect().height,panes:[...document.querySelectorAll(".owner-settings-dialog,.recycle-bin-body")].map(e=>({width:e.clientWidth,scroll:e.scrollWidth}))})')
   r=json.loads(json.loads(raw));assert r['scroll']<=r['width']+1 and all(p['scroll']<=p['width']+1 for p in r['panes']),r
   r.update(lang=lang,theme=theme);results.append(r)
   run('screenshot',str(root/f'{width}-{lang}-{theme}.png'))
(root/'layout-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':len(results),'results':results}))
