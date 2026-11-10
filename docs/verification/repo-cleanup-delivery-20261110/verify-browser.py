from pathlib import Path
import json,subprocess,time
out=Path('.scratch/repo-cleanup-delivery-20261110');session=(out/'browser-session.txt').read_text().strip();events=[];proof=[]
def run(*args):
 p=subprocess.run(['agent-browser','--session',session,*args,'--json'],text=True,capture_output=True,timeout=45);r=json.loads(p.stdout);events.append({'args':args,'result':r});(out/'browser-events.json').write_text(json.dumps(events,ensure_ascii=False,indent=2));assert p.returncode==0 and r['success'],r;return r.get('data')
def js(code):return run('eval',code)['result']
run('open','http://127.0.0.1:5195/__cleanup')
end=time.monotonic()+20
while not js("!!document.querySelector('[aria-label=\"Worker 任务进度\"]')"):
 assert time.monotonic()<end,'real task panel did not mount';time.sleep(.2)
snapshot="[...document.querySelectorAll('#root *')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{tag:e.tagName,text:e.childElementCount?'':e.textContent,box:[r.x,r.y,r.width,r.height],css:Object.fromEntries([...s].map(k=>[k,s.getPropertyValue(k)]))}})"
def css(name):return js("new Promise((resolve,reject)=>{const old=document.querySelector('#current-style'),l=document.createElement('link');l.rel='stylesheet';l.id='current-style';l.onload=()=>{old.remove();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))};l.onerror=()=>reject(Error('CSS did not load'));l.href="+json.dumps('/__'+name+'.css')+";document.head.append(l)})")
for theme in ['light','dark']:
 for width in [1280,390]:
  run('set','viewport',str(width),'900');js("document.querySelector('.app-shell').dataset.theme="+json.dumps(theme));css('before');before=js(snapshot);css('after');after=js(snapshot);assert before==after,(theme,width,'computed styles changed');run('screenshot','--full',str((out/('task-panel-'+theme+'-'+str(width)+'.png')).resolve()));proof.append({'theme':theme,'width':width,'nodes':len(after),'allComputedStylesAndGeometryEqual':True})
(out/'browser-result.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2));run('close');print(json.dumps(proof,ensure_ascii=False))
