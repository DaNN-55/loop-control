import subprocess,json,pathlib,re,time
out=pathlib.Path(__file__).parent;events=[];session='state-followup12-f20b54167b1b'
def run(*args):
 p=subprocess.run(['agent-browser','--session',session,*args,'--json'],capture_output=True,text=True,timeout=45);r=json.loads(p.stdout);events.append({'args':args,'result':r});(out/'browser-results.json').write_text(json.dumps(events,ensure_ascii=False,indent=2));assert p.returncode==0 and r.get('success'),(args,r);return r.get('data')
def js(code):return run('eval',code)['result']
def wait(code):
 end=time.monotonic()+15
 while not js(code):
  assert time.monotonic()<end,code
  time.sleep(.1)
def focus_role(role,name):
 snapshot=run('snapshot','-i')['snapshot'];m=re.search(r'\b'+role+' "'+re.escape(name)+r'" \[(?:[^]\n]*?ref=)(e\d+)',snapshot);assert m,snapshot;run('focus','@'+m.group(1))
def click(name):focus_role('button',name);run('press','Enter')
def box(name):focus_role('checkbox',name);run('press','Space')
def stats():return js("fetch('/__stats').then(r=>r.json())")
def enabled(name):return "[...document.querySelectorAll('button')].some(b=>(b.textContent.trim()==="+json.dumps(name)+"||b.getAttribute('aria-label')==="+json.dumps(name)+")&&!b.disabled&&b.checkVisibility())"
def checked(name):return "document.querySelector('input[aria-label=\""+name+"\"]')?.checked"
def no_dialog():wait("!document.querySelector('[role=dialog]')")
def mark(name):events.append({'scenario':name,'passed':True,'stats':stats()});(out/'browser-results.json').write_text(json.dumps(events,ensure_ascii=False,indent=2))
def model_case(name):
 current=js("document.querySelector('select[aria-label=\"模型场景\"]').value")
 if current==name:
  other='clean' if name!='clean' else 'discovery';run('select','select[aria-label="模型场景"]',other);wait("document.querySelector('select[aria-label=\"模型场景\"]').value==="+json.dumps(other))
 run('select','select[aria-label="模型场景"]',name);wait("document.querySelector('select[aria-label=\"模型场景\"]').value==="+json.dumps(name))
 click('打开模型设置');wait("!!document.querySelector('input[aria-label=\"model-1\"]')")
run('open','http://127.0.0.1:5195/__followup12');run('set','viewport','1280','900');wait(enabled('试听当前音色'))
click('试听当前音色');wait("document.querySelector('output').textContent==='1'");sourceA=js("document.querySelector('audio').src");wait("document.querySelector('audio').paused")
run('find','label','语速','fill','0.8');click('试听当前音色');wait("document.querySelector('output').textContent==='2'");assert js("document.querySelector('audio').playbackRate")==.8;assert len(stats()['samples'])==1
run('select','select[aria-label="音色"]','B');wait(enabled('试听当前音色'));click('试听当前音色');wait("document.querySelector('output').textContent==='3'");assert js("document.querySelector('audio').src")!=sourceA;assert [x['voice'] for x in stats()['samples']]==['A','B'];mark('cached voice change and speed-only reuse with actual MP3 playback')
run('select','select[aria-label="样音场景"]','missing');wait("document.querySelector('output').textContent==='0'");click('试听当前音色');wait("!!document.querySelector('[role=dialog]')");assert not any(x['generate'] for x in stats()['samples']);click('确认合成并试听');wait("document.querySelector('output').textContent==='1'");no_dialog();run('select','select[aria-label="音色"]','B');click('试听当前音色');wait("!!document.querySelector('[role=dialog]')");assert [(x['voice'],x['generate']) for x in stats()['samples']]==[('A',False),('A',True),('B',False)];click('取消');no_dialog();mark('new voice retains first-synthesis confirmation and never synthesizes automatically')
run('select','select[aria-label="样音场景"]','delayed');wait("document.querySelector('output').textContent==='0'");click('试听当前音色');wait("fetch('/__stats').then(r=>r.json()).then(v=>v.held.includes('A'))");run('select','select[aria-label="音色"]','B');wait(enabled('试听当前音色'));click('试听当前音色');wait("fetch('/__stats').then(r=>r.json()).then(v=>v.held.includes('B'))");click('释放 A');assert js("document.querySelector('output').textContent")=='0';assert not js(enabled('试听当前音色'));click('释放 B');wait("document.querySelector('output').textContent==='1'");mark('late old source cannot play or release the new source request')
run('select','select[aria-label="核对面板"]','models');model_case('concurrent');click('读取模型');wait(checked('model-2'));assert not js(enabled('保存设置'));assert len(stats()['models'])==1;click('取消');no_dialog();mark('clean refresh follows current server enabled models without creating a draft')
model_case('concurrent');box('model-1');box('model-3');click('读取模型');wait("[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('其他窗口'))");assert js(checked('model-3'));assert not js(checked('model-2'));assert not js(enabled('保存设置'));assert all(x['operation']!='save' for x in stats()['models'])
run('screenshot',str((out/'model-conflict-wide.png').resolve()));run('set','viewport','390','844');run('screenshot','--full',str((out/'model-conflict-mobile.png').resolve()));assert js('document.documentElement.scrollWidth<=innerWidth');run('set','viewport','1280','900');click('取消');wait(enabled('保留修改并关闭'));click('保留修改并关闭');no_dialog();wait("fetch('/__stats').then(r=>r.json()).then(v=>v.drafts.some(d=>d?.revision==='r1'))");assert [d for d in stats()['drafts'] if d][-1]=={'versionId':'v','revision':'r1','enabledModels':['model-3']}
click('打开模型设置');wait("document.body.innerText.includes('保留的修改所依据的版本已变化')");assert js(checked('model-2'));assert not js(checked('model-3'));click('取消');no_dialog();mark('concurrent edits keep old CAS and draft; reopen preserves existing version-isolation restriction')
model_case('discovery');box('model-1');click('读取模型');wait(enabled('保存设置'));assert not js(checked('model-1'));click('保存设置');no_dialog();s=stats();assert s['models'][-1]=={'operation':'save','data':{'connectionId':'c','versionId':'v','revision':'r2','enabledModels':[]}};mark('discovery-only revision advance preserves a real draft and saves with current CAS')
model_case('save-race');box('model-1');click('保存设置');wait("[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('已被修改'))");assert not js(checked('model-1'));assert stats()['settings']['enabledModels']==['model-2'];assert [x for x in stats()['models'] if x['operation']=='save']==[{'operation':'save','data':{'connectionId':'c','versionId':'v','revision':'r1','enabledModels':[]}}];click('取消');click('保留修改并关闭');no_dialog();mark('save rejected after another change retains draft without automatic retry')
print('7 controlled browser flows passed')
