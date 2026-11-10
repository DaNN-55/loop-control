import subprocess,json,pathlib,re,time,sys
from urllib.request import Request,urlopen
out=pathlib.Path(__file__).parent;events=[];session='state-batch5-f20b54167b1b'
def run(*args):
 p=subprocess.run(['agent-browser','--session',session,*args,'--json'],capture_output=True,text=True,timeout=45)
 r=json.loads(p.stdout);events.append({'args':args,'result':r});(out/'browser-results.json').write_text(json.dumps(events,ensure_ascii=False,indent=2));assert p.returncode==0 and r.get('success'),(args,r);return r.get('data')
def js(code):return run('eval',code)['result']
def click(name):
 run('frame','main');snapshot=run('snapshot','-i')['snapshot'];match=re.search(r'button "'+re.escape(name)+r'" \[(?:[^]\n]*?ref=)(e\d+)',snapshot);assert match,snapshot
 run('focus','@'+match.group(1));run('press','Enter')
def wait_condition(expression):
 deadline=time.monotonic()+15
 while not js(expression):
  assert time.monotonic()<deadline,expression
  time.sleep(.1)
def wait_button(name):wait_condition("[...document.querySelectorAll('button')].some(b=>(b.textContent.trim()==="+json.dumps(name)+"||b.getAttribute('aria-label')==="+json.dumps(name)+")&&!b.disabled&&b.checkVisibility())")

def stats():return js("fetch('/__stats').then(r=>r.json())")
def choose(mode):
 run('frame','main');run('select','select[aria-label="核对场景"]',mode);run('wait','--fn',"document.querySelector('select').value==="+json.dumps(mode)+"&&!document.body.innerText.includes('正在读取制作流程')")
def open_editor():wait_button('进入剪辑工作台');click('进入剪辑工作台');wait_button('保存')
def edit(value):
 snapshot=run('snapshot','-i')['snapshot'];match=re.search(r'textbox "原生夹具正文" \[ref=(e\d+)\]',snapshot);assert match,snapshot
 run('fill','@'+match.group(1),value);run('frame','main')
def value():return js("document.querySelector('iframe').contentDocument.querySelector('textarea').value")
def verify_frame():assert js("!!document.querySelector('iframe')")
def mark(name):events.append({'scenario':name,'passed':True,'stats':stats()});(out/'browser-results.json').write_text(json.dumps(events,ensure_ascii=False,indent=2))
urlopen(Request('http://127.0.0.1:5194/__case',data=b'{"mode":"ready"}',method='POST')).read()
run('open','http://127.0.0.1:5194/__stage5');run('set','viewport','1280','900')
if '--remaining' not in sys.argv and '--rest' not in sys.argv:
 choose('prepare-failed');wait_button('重试');assert stats()['counts']['prepareWorkspace']==1;click('重试');wait_button('进入剪辑工作台');assert stats()['counts']['prepareWorkspace']==2;mark('prepare failure, explicit retry')
if '--rest' not in sys.argv:
 choose('open-failed');wait_button('进入剪辑工作台');click('进入剪辑工作台');run('wait','--text','夹具打开失败');assert not js("!!document.querySelector('iframe')");open_editor();edit('打开重试后的正文');click('保存并返回分镜台');wait_button('进入剪辑工作台');mark('open failure, save and return with selected shot')
for mode,message in [('save-failed','夹具保存失败'),('close-failed','夹具关闭失败'),('flush-failed','夹具刷盘失败')]:
 choose(mode);open_editor();edit('失败后保留的正文：'+mode);launch=js("document.querySelector('iframe').src");click('保存');run('wait','--text',message);wait_button('保存');verify_frame();assert value()=='失败后保留的正文：'+mode;assert js("document.querySelector('iframe').src")==launch
 s=stats();assert s['counts'].get('closeWorkspaceStudio',0)==(1 if mode=='close-failed' else 0)
 if mode=='flush-failed':assert s['counts'].get('saveWorkspaceStudio',0)==0
 if mode=='close-failed':run('screenshot',str((out/'close-failed-wide.png').resolve()));run('set','viewport','390','844');run('screenshot','--full',str((out/'close-failed-mobile.png').resolve()));assert js('document.documentElement.scrollWidth<=innerWidth');run('set','viewport','1280','900')
 click('保存');run('wait','--fn',"!document.querySelector('iframe')&&document.querySelector('nav[aria-label=\"四步制作步骤\"] button[aria-current=\"page\"]')?.textContent.includes('检查与交付')")
 s=stats();assert s['w']['revision']==(4 if mode=='close-failed' else 3);assert s['text']=='失败后保留的正文：'+mode;mark(mode+' keeps frame and recovers')
choose('slow-open');wait_button('进入剪辑工作台');click('剪辑工作台');run('wait','--text','正在打开剪辑工作台');run('back');run('wait','--fn',"document.querySelector('nav[aria-label=\"四步制作步骤\"] button[aria-current=\"page\"]')?.textContent.includes('分镜台')");click('释放旧打开结果');wait_button('进入剪辑工作台');assert not js("!!document.querySelector('iframe')");assert stats()['w']['revision']==2;open_editor();assert stats()['calls'][-1]['data']['expectedRevision']==2;click('保存并返回分镜台');wait_button('进入剪辑工作台');mark('browser back, late open readback, revision-safe explicit reopen')
# URL refresh remains a viewing operation; explicit retry is required to create a new editor session.
click('剪辑工作台');wait_button('保存');before=stats()['counts']['openWorkspaceStudio'];run('reload');wait_button('重试打开剪辑工作台');assert stats()['counts']['openWorkspaceStudio']==before;assert not js("!!document.querySelector('iframe')");click('重试打开剪辑工作台');wait_button('保存');click('保存并返回分镜台');wait_button('进入剪辑工作台');mark('editing deep link and refresh require explicit open, saved return works')
print('7 controlled browser operation flows passed')
