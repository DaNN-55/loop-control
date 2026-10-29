"""Run after serve.ts and the actual native inspector is open; bounded failure signal."""
import json,subprocess,sys,time
session=sys.argv[1];output=sys.argv[2];cli=['agent-browser','--session',session]
def run(args,timeout=10):
 start=time.monotonic()
 try:
  p=subprocess.run(cli+args,capture_output=True,text=True,timeout=timeout)
  return {'args':args,'ms':round((time.monotonic()-start)*1000),'code':p.returncode,'output':p.stdout.strip(),'error':p.stderr.strip()}
 except subprocess.TimeoutExpired:return {'args':args,'ms':round((time.monotonic()-start)*1000),'timeout':True}
raf=['eval','new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({responsive:true,width:innerWidth,pageWidth:document.documentElement.scrollWidth,hostOpen:!!document.querySelector(".embedded-studio-body.panel-open")}))))']
records=[run(raf),run(['trace','start']),run(['find','role','button','click','--name','口播版本','--exact']),run(raf,8),run(['snapshot','-i','-s','.workspace-candidates'],8),run(raf,8),run(['trace','stop',output+'.trace.json'],8)]
with open(output,'w') as f:json.dump({'records':records},f,ensure_ascii=False,indent=2)
print(json.dumps({'records':records},ensure_ascii=False))
if any(r.get('timeout') or r.get('code',0)!=0 for r in records):sys.exit(1)
