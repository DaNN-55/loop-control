import subprocess,json,pathlib
root=pathlib.Path(__file__).resolve().parent
base='http://127.0.0.1:5210/docs/verification/recycle-bin-migration-20261111/browser/index.html'
def run(*args):
 p=subprocess.run(['agent-browser','--session','loop-recycle-ui',*args],capture_output=True,text=True,check=True)
 return p.stdout.strip()
results=[]
for width,height in [(1348,953),(1024,768),(768,953),(390,844)]:
 run('set','viewport',str(width),str(height))
 for theme in ['light','dark']:
  for lang in ['zh','en']:
   run('open',base+'?theme='+theme+'&lang='+lang)
   value=run('eval','JSON.stringify({width:innerWidth,body:document.documentElement.scrollWidth,panes:[...document.querySelectorAll(".owner-settings-dialog,.recycle-bin-body")].map(e=>({width:e.clientWidth,scroll:e.scrollWidth}))})')
   metrics=json.loads(json.loads(value))
   assert metrics['body']<=metrics['width']+1,metrics
   assert len(metrics['panes'])==2 and all(v['scroll']<=v['width']+1 for v in metrics['panes']),metrics
   run('screenshot',str(root/f'populated-{width}-{theme}-{lang}.png'))
   results.append({'width':width,'height':height,'theme':theme,'lang':lang,'metrics':metrics})
   (root/'layout-result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(results),'horizontalOverflow':0}))
