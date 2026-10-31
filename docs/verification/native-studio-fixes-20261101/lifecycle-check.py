from pathlib import Path
import os,subprocess,json,time,signal,urllib.request
base=Path('/private/tmp/loop-control-sdk-fixes-20261101');project=Path('/Users/dan/Programs/loop-control');sdk=project/'.loop-control/local/OpenChatCut';results=[]
def http(port):
 try:
  with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/',timeout=1) as r:return r.status
 except Exception:return 0
for n,mode in enumerate(['foreground','detached']):
 b=base/('lifecycle-'+mode);b.mkdir(mode=0o700,exist_ok=False)
 for k in ['data','cache']:(b/k).mkdir(mode=0o700)
 port=59303+n
 with (b/'parent.log').open('ab') as log:p=subprocess.Popen(['node',str(base/'lifecycle-parent.mjs'),mode,str(port),str(b),str(project),str(sdk)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
 for i in range(100):
  if (b/'child.json').exists() and http(port)==200:break
  time.sleep(.1)
 else:raise Exception('Owned test SDK did not start')
 child=json.loads((b/'child.json').read_text());cp=child['pid'];assert os.getpgid(p.pid)==p.pid
 assert os.getpgid(cp)==(cp if mode=='detached' else p.pid)
 os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5);time.sleep(.2);status=http(port)
 assert status==(200 if mode=='detached' else 0)
 results.append({'mode':mode,'parentPid':p.pid,'childPid':cp,'readyHttpStatus':200,'parentGroupTerminated':'SIGKILL','httpAfterParentGroupTerminated':status,'expected':True})
 if mode=='detached':
  os.kill(cp,signal.SIGTERM)
  for i in range(100):
   if not http(port):break
   time.sleep(.1)
  assert not http(port)
(base/'lifecycle-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
