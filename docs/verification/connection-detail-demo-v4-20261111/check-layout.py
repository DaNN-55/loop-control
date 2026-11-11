import subprocess,json,pathlib
root=pathlib.Path(__file__).resolve().parent
base='http://127.0.0.1:5210/src/local-app/connection-detail-v4.prototype.html'
def run(*args):
 return subprocess.run(['agent-browser','--session','cd4-isolated',*args],capture_output=True,text=True,check=True).stdout.strip()
def measure():
 value=run('eval','JSON.stringify({body:document.documentElement.scrollWidth,width:innerWidth,panes:[...document.querySelectorAll(".cd4-dialog,.cd4-scroll")].map(e=>({width:e.clientWidth,scroll:e.scrollWidth})),panels:document.querySelectorAll("[role=tabpanel]").length,footer:Math.round(document.querySelector(".cd4-footer").getBoundingClientRect().top)})')
 return json.loads(json.loads(value))
results=[]
for variant in ['compact','balanced','dense']:
 for width,height,lang,theme in [(1340,953,'zh','light'),(390,844,'en','dark')]:
  run('set','viewport',str(width),str(height));run('open',base+f'?variant={variant}&connection=openai&lang={lang}&theme={theme}')
  anchors=[]
  for tab,name in [('connection','连接' if lang=='zh' else 'Connection'),('models','模型' if lang=='zh' else 'Models'),('billing','用量与计费' if lang=='zh' else 'Usage & billing'),('history','记录' if lang=='zh' else 'History')]:
   run('find','role','tab','click','--name',name,'--exact');snapshot=run('snapshot','-i');assert name in snapshot
   m=measure();assert m['body']<=m['width']+1,m;assert len(m['panes'])==2 and all(v['scroll']<=v['width']+1 for v in m['panes']),m;assert m['panels']==1,m;anchors.append(m['footer'])
   if variant=='compact' or (tab=='connection' and lang=='en'):run('screenshot',str(root/f'{variant}-{tab}-{width}-{lang}-{theme}.png'))
   results.append({'variant':variant,'width':width,'lang':lang,'theme':theme,'tab':tab,'metrics':m});(root/'layout-result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
  assert len(set(anchors))==1,anchors
print(json.dumps({'passed':len(results),'horizontalOverflow':0,'footerAnchors':'unchanged across four tabs in every variant/width'}))
