from pathlib import Path
import json,subprocess
ROOT=Path(__file__).resolve().parent
SESSION='compact-settings-v3-f20b54167b1b'
def cmd(*args):
 r=subprocess.run(['agent-browser','--session',SESSION,*args],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stdout+r.stderr)
 return r.stdout.strip()
results=[]
for width,theme,lang in [(1348,'light','zh'),(320,'dark','en')]:
 cmd('set','viewport',str(width),'953')
 for variant in ['rows','split','groups']:
  for page in ['connections','secrets','recycle']:
   cmd('open',f'http://127.0.0.1:5210/src/local-app/settings-review-v2.prototype.html?page={page}&variant={variant}&theme={theme}&lang={lang}&stress=1')
   cmd('wait','--fn',"document.querySelector('.sr2-window') !== null")
   result=json.loads(cmd('a11y','--selector','.sr2-window','--tags','wcag2a,wcag2aa','--json'))
   result.update(width=width,page=page,variant=variant,theme=theme)
   results.append(result)
   if width==320 and variant=='split':cmd('screenshot',str(ROOT/f'{variant}-{page}-{width}-{theme}-stress-english.png'))
(ROOT/'a11y-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
(ROOT/'browser-errors.json').write_text(cmd('errors','--json')+'\n')
print('Axe',len(results),'scenes;',sum(x['data']['counts']['violations'] for x in results),'violations')
print('Incomplete:',[(r['width'],r['variant'],r['page'],[x['id'] for x in r['data']['incomplete']]) for r in results if r['data']['incomplete']])
