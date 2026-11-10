import subprocess,json,pathlib,sys
out=pathlib.Path(__file__).parent
session='state-batch4-f20b54167b1b';events=[]
def run(*args):
 p=subprocess.run(['agent-browser','--session',session,*args,'--json'],capture_output=True,text=True,timeout=45)
 try:r=json.loads(p.stdout)
 except Exception:raise AssertionError((args,p.stdout,p.stderr))
 events.append({'args':args,'result':r})
 (out/'browser-results.json').write_text(json.dumps(events,ensure_ascii=False,indent=2))
 assert p.returncode==0 and r.get('success'),(args,r)
 return r.get('data')
def js(code):return run('eval',code)['result']
def click(label):run('find','role','button','click','--name',label,'--exact')
def wait_button(label):run('wait','--fn',"[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==="+json.dumps(label)+"&&!b.disabled&&b.checkVisibility())")
def fill(label,text):run('find','label',label,'fill',text,'--exact')
def stats():return js("fetch('/__stats').then(r=>r.json())")
def choose(name):
 js('localStorage.clear();sessionStorage.clear();true')
 run('select','select[aria-label="核对场景"]',name)
 run('wait','--fn',"document.querySelector('select').value==="+json.dumps(name)+"&&!document.body.innerText.includes('正在读取制作流程')")
 if not js("document.querySelector('nav[aria-label=\"四步制作步骤\"] button')?.getAttribute('aria-current')==='page'"):
  run('find','first','nav[aria-label=\"四步制作步骤\"] button','click')
 if name=='revision-start-failed':
  if js("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='修改脚本'&&b.checkVisibility())"):wait_button('修改脚本');click('修改脚本')
 run('wait','--fn',"!!document.querySelector('textarea[aria-label=\"主脚本\"]')&&!document.querySelector('textarea[aria-label=\"主脚本\"]').disabled")
def submit(name):
 fill('主脚本','浏览器验证正文。\n第二段。')
 if name=='revision-start-failed':fill('脚本修订原因','调整叙事');click('确认脚本修订');click('确认保存修订')
 else:click('确认脚本')
def failure():
 wait_button('继续启动');assert js("document.querySelector('textarea[aria-label=\"主脚本\"]').value")=='浏览器验证正文。\n第二段。'
 assert not any(c['command']=='prepareWorkspace' and c['data'].get('expectedScriptRevisionId')=='saved' for c in stats()['calls'])
from urllib.request import Request,urlopen
urlopen(Request('http://127.0.0.1:5193/__case',data=b'{"name":"start-failed"}',method='POST')).read()
run('open','http://127.0.0.1:5193/__stage4');run('set','viewport','1280','900')
for name in (sys.argv[1:] or ['start-failed','unknown-start','save-failed','revision-start-failed','conflict','read-failed']):
 choose(name);submit(name)
 if name=='save-failed':
  run('wait','--text','保存结果未确认，尚未启动制作。');assert stats()['starts']==0
  assert js("document.querySelector('textarea').value")=='浏览器验证正文。\n第二段。'
  click('确认脚本');run('wait','--fn',"document.querySelector('nav[aria-label=\"四步制作步骤\"] button[aria-current=\"page\"]')?.textContent.includes('分镜台')");assert [c['command'] for c in stats()['calls']]==['importMaterial','importMaterial','start','prepareWorkspace'];continue
 failure()
 if name=='revision-start-failed':
  assert js("document.querySelector('input[aria-label=\"脚本修订原因\"]').value")=='调整叙事'
  run('screenshot',str((out/'saved-start-failed-wide.png').resolve()));run('set','viewport','390','844');run('screenshot',str((out/'saved-start-failed-mobile.png').resolve()));assert js('document.documentElement.scrollWidth<=innerWidth');run('set','viewport','1280','900')
 click('继续启动')
 if name=='conflict':
  run('wait','--text','当前脚本版本或生产单状态已变化');assert stats()['starts']==1;assert js("document.querySelector('textarea').value")=='浏览器验证正文。\n第二段。';continue
 if name=='read-failed':
  run('wait','--text','核对连接中断');assert stats()['starts']==1;click('继续启动')
 run('wait','--fn',"document.querySelector('nav[aria-label=\"四步制作步骤\"] button[aria-current=\"page\"]')?.textContent.includes('分镜台')");s=stats();assert s['starts']==(1 if name=='unknown-start' else 2)
 assert len([c for c in s['calls'] if c['command'] in ['importMaterial','reconfirmScript']])==1
 assert len([c for c in s['calls'] if c['command']=='prepareWorkspace' and c['data'].get('expectedScriptRevisionId')=='saved'])==1
 events.append({'scenario':name,'assertions':'passed','stats':s})
# Remount the saved waiting-input baseline; no draft or idempotency protocol migration.
choose('start-failed');submit('start-failed');failure();run('reload');wait_button('确认脚本');click('确认脚本');run('wait','--fn',"document.querySelector('nav[aria-label=\"四步制作步骤\"] button[aria-current=\"page\"]')?.textContent.includes('分镜台')");assert len([c for c in stats()['calls'] if c['command']=='importMaterial'])==1
(out/'browser-results.json').write_text(json.dumps(events,ensure_ascii=False,indent=2));print('Selected browser flows and saved-script remount passed')
