"""Run after opening serve.ts's isolated Studio with agent-browser's own session."""
import json,re,subprocess,sys,time
session=sys.argv[1];destination=sys.argv[2]
cli=['agent-browser','--session',session];records=[]
def run(args,timeout=12):
 started=time.monotonic();p=subprocess.run(cli+args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError(str(args)+': '+p.stderr)
 return p.stdout.strip(),round((time.monotonic()-started)*1000)
def snapshot():return run(['snapshot','-i'])[0]
def inspector(wanted):
 tree=snapshot();visible='button "片段属性' in tree
 if visible!=wanted:
  ref=re.search(r'button "属性"[^\n]*ref=(e\d+)',tree)
  if not ref:raise RuntimeError('Native inspector toggle absent')
  run(['click','@'+ref.group(1)]);tree=snapshot()
 if ('button "片段属性' in tree)!=wanted:raise RuntimeError('Native inspector did not reach requested state')
def probe():
 value,ms=run(['eval','new Promise(resolve=>{const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({rafMs:performance.now()-start,width:innerWidth,pageWidth:document.documentElement.scrollWidth,hostOpen:!!document.querySelector(".embedded-studio-body.panel-open"),frameWidth:document.querySelector("iframe").getBoundingClientRect().width})))})'],8)
 return {'responseMs':ms,**json.loads(value)}
for width in [1280,800]:
 run(['set','viewport',str(width),'720']);run(['find','role','button','click','--name','定位镜头 shot-1'])
 run(['eval','(()=>{document.querySelector(".embedded-studio>header button[aria-pressed=true]")?.click();return true})()'])
 run(['wait','--fn','!document.querySelector(".embedded-studio-body.panel-open")'])
 for cycle in range(3):
  inspector(True)
  run(['click','.embedded-studio>header button[aria-pressed]']);run(['wait','--fn','!!document.querySelector(".embedded-studio-body.panel-open")'])
  # The host waits for native collapse before reducing the native viewport.
  if 'button "片段属性' in snapshot():raise RuntimeError('Host tools opened before native inspector collapsed')
  inspector(True) # Owner may explicitly open the native inspector again.
  scoped,axMs=run(['snapshot','-i','-s','.workspace-captions'],8)
  result={'width':width,'cycle':cycle+1,'nativeInspectorOpen':True,'captionAXMs':axMs,'captionAXPresent':'字幕正文' in scoped,**probe()}
  if result['pageWidth']>width or not result['captionAXPresent']:raise RuntimeError(str(result))
  records.append(result)
  if cycle==2:run(['screenshot',destination+f'/caption-and-native-{width}.png'])
  run(['click','.embedded-studio>header button[aria-pressed]']);run(['wait','--fn','!document.querySelector(".embedded-studio-body.panel-open")']);records.append({'width':width,'cycle':cycle+1,'hostClosed':True,**probe()})
with open(destination+'/ui-tool-matrix.json','w')as f:json.dump(records,f,ensure_ascii=False,indent=2)
print(json.dumps(records,ensure_ascii=False))
