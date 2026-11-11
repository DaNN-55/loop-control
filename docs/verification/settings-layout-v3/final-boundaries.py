from pathlib import Path
import json,subprocess
ROOT=Path(__file__).resolve().parent
SESSION='compact-settings-v3-f20b54167b1b'
def cmd(*args):
 r=subprocess.run(['agent-browser','--session',SESSION,*args],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stdout+r.stderr)
 return r.stdout.strip()
audit=json.loads((ROOT/'a11y-results.json').read_text())
results=[]
for variant in ['rows','split','groups']:
 for page in ['connections','secrets','recycle']:
  cmd('set','viewport','320','953')
  cmd('open',f'http://127.0.0.1:5210/src/local-app/settings-review-v2.prototype.html?page={page}&variant={variant}&theme=dark&lang=en&stress=1')
  cmd('wait','--fn',"document.querySelector('.sr2-window') !== null")
  checks=[node['target'][0] for r in audit if r['width']==320 and r['page']==page and r['variant']==variant for finding in r['data']['incomplete'] if finding['id']=='color-contrast' for node in finding['nodes']]
  js="""JSON.stringify((()=>{const selectors=SELECTORS;function color(s){return s.match(/[\\d.]+/g).map(Number)}function luminance(c){return c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)}return {viewport:innerWidth,page:document.documentElement.scrollWidth,dialog:document.querySelector('.sr2-window').scrollWidth,dialogWidth:document.querySelector('.sr2-window').clientWidth,names:Array.from(document.querySelectorAll('.sr2-name,.sr2-secret-identity>strong')).map(e=>({height:e.getBoundingClientRect().height,lineHeight:getComputedStyle(e).lineHeight,clamp:getComputedStyle(e).webkitLineClamp,title:e.title})),contrast:selectors.map(selector=>{const e=document.querySelector(selector);let p=e,bg;while(p){bg=color(getComputedStyle(p).backgroundColor);if(bg.length<4||bg[3]===1)break;p=p.parentElement}const fg=color(getComputedStyle(e).color);const a=luminance(fg),b=luminance(bg);return {selector,foreground:fg,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}})}})())""".replace('SELECTORS',json.dumps(checks))
  data=json.loads(json.loads(cmd('eval',js)))
  data.update(pageName=page,variant=variant)
  results.append(data)
  cmd('screenshot',str(ROOT/f'{variant}-{page}-320-dark-stress-english.png'))
(ROOT/'final-boundaries-and-contrast.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
ratios=[c['ratio'] for r in results for c in r['contrast']]
print('Final 320px boundaries:',len(results),'scenes, all within viewport:',all(r['page']<=320 and r['dialog']<=r['dialogWidth'] for r in results))
print('Manual computed contrast for axe overlap uncertainties:',len(ratios),'text samples; minimum',round(min(ratios),2))
