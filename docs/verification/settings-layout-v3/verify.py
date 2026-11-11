from pathlib import Path
import json,subprocess
ROOT=Path(__file__).resolve().parent
SESSION='compact-settings-v3-f20b54167b1b'
def command(*args):
    result=subprocess.run(['agent-browser','--session',SESSION,*args],capture_output=True,text=True)
    if result.returncode: raise RuntimeError(result.stdout+result.stderr)
    return result.stdout.strip()
js='''JSON.stringify((()=>{const root=document.querySelector('.sr2-window'),main=document.querySelector('.sr2-main');return {viewport:innerWidth,document:document.documentElement.scrollWidth,dialog:root.clientWidth,dialogScroll:root.scrollWidth,main:main.clientWidth,mainScroll:main.scrollWidth,horizontal:Array.from(root.querySelectorAll('*')).filter(e=>e.getClientRects().length&&e.tagName!=='OPTION'&&!e.closest('.sr2-demo-controls')&&e.getBoundingClientRect().right>root.getBoundingClientRect().right+2).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,text:e.textContent.slice(0,60)})).slice(0,10),detail:Array.from(root.querySelectorAll('.sr2-detail')).map(e=>({height:e.getBoundingClientRect().height,width:e.clientWidth,scroll:e.scrollWidth})),title:root.getAttribute('aria-label')}})())'''
results=[]
scenes=[]
for width in [1348,768,375]:
 for theme in ['light','dark']:
  for variant in ['rows','split','groups']:
   for page in ['connections','secrets','recycle']:
    scenes.append((width,theme,variant,page,''))
for width in [1348,375]:
 for variant in ['rows','split','groups']:
  for page in ['connections','secrets','recycle']:
   scenes.append((width,'light',variant,page,'&lang=en'))
for variant in ['rows','split','groups']:
 for page in ['connections','secrets','recycle']:
  scenes.append((320,'dark',variant,page,'&stress=1&lang=en'))
lastWidth=None
for i,(width,theme,variant,page,extra) in enumerate(scenes):
 if width!=lastWidth:
  command('set','viewport',str(width),'953');lastWidth=width
 command('open',f'http://127.0.0.1:5210/src/local-app/settings-review-v2.prototype.html?page={page}&variant={variant}&theme={theme}{extra}')
 command('wait','--fn',"document.querySelector('.sr2-window') !== null")
 result=json.loads(json.loads(command('eval',js)))
 result.update(width=width,theme=theme,variant=variant,page=page,extra=extra)
 results.append(result)
 if (width==1348 and theme=='light' and not extra) or (width==375 and theme=='dark' and not extra) or width==320:
  suffix='-stress-english' if width==320 else ''
  command('screenshot',str(ROOT/f'{variant}-{page}-{width}-{theme}{suffix}.png'))
 if result['horizontal'] or result['document']>width or result['dialogScroll']>result['dialog']+1 or result['mainScroll']>result['main']+1:
  print('OVERFLOW',width,theme,variant,page,result['horizontal'],flush=True)
 if (i+1)%18==0:print(f'checked {i+1}/{len(scenes)}',flush=True)
(ROOT/'browser-layout-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print('Done:',len(results),'scenes;',sum(bool(r['horizontal']) or r['document']>r['width'] or r['dialogScroll']>r['dialog']+1 or r['mainScroll']>r['main']+1 for r in results),'overflow scenes',flush=True)
