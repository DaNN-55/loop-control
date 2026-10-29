import json,math,re
from pathlib import Path
D=Path(__file__).parent

def linear(c):return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4

def parse(s):
 if s.startswith('rgb'):
  v=re.findall(r'[\d.]+',s);return [linear(float(v[i])/255) for i in range(3)]+[float(v[3]) if len(v)>3 else 1]
 if s.startswith('oklch'):
  body=s[s.index('(')+1:s.rindex(')')];v=re.findall(r'-?[\d.]+%?',body);L=float(v[0].rstrip('%'))/(100 if '%' in v[0] else 1);C=float(v[1]);h=math.radians(float(v[2])) if len(v)>2 else 0;a=C*math.cos(h);b=C*math.sin(h)
  l=(L+.3963377774*a+.2158037573*b)**3;m=(L-.1055613458*a-.0638541728*b)**3;t=(L-.0894841775*a-1.291485548*b)**3
  rgb=[4.0767416621*l-3.3077115913*m+.2309699292*t,-1.2684380046*l+2.6097574011*m-.3413193965*t,-.0041960863*l-.7034186147*m+1.707614701*t]
  return [min(1,max(0,c)) for c in rgb]+[float(v[3]) if len(v)>3 else 1]
 if s=='transparent':return [0,0,0,0]
 return None

def encoded(c):return 12.92*c if c<=.0031308 else 1.055*c**(1/2.4)-.055
def blend(a,b):return [linear(encoded(a[i])*a[3]+encoded(b[i])*(1-a[3])) for i in range(3)]+[1]

def luminance(c):return sum(c[i]*w for i,w in enumerate([.2126,.7152,.0722]))
res=[];rows=json.loads((D/'measurements.json').read_text())
for page in rows:
 for el in page['colorSamples']:
  fg=parse(el['color'])
  if not fg:continue
  bg=[1,1,1,1];uncertain=False
  for layer in reversed(el['back']):
   c=parse(layer['color']);uncertain|=layer['image']!='none'
   if c:bg=blend(c,bg)
  fg=blend(fg,bg);a,b=sorted([luminance(fg),luminance(bg)]);ratio=(b+.05)/(a+.05)
  threshold=3 if float(el['fontSize'].removesuffix('px'))>=24 or float(el['fontSize'].removesuffix('px'))>=18.66 and int(el['weight'])>=700 else 4.5
  if ratio<threshold and not uncertain:
   res.append({'scene':page['scene'],'theme':page['theme'],'width':page['width'],'ratio':round(ratio,2),'threshold':threshold,'text':el['text'],'cls':el['cls'],'fontSize':el['fontSize'],'foreground':el['color'],'backgrounds':[x['color'] for x in el['back'] if x['color']!='rgba(0, 0, 0, 0)'],'source':'computed CSS; sRGB/OKLCH converted to linear sRGB, no screenshot pixel or browser AA proof'})
(D/'contrast-candidates.json').write_text(json.dumps(res,ensure_ascii=False,indent=2)+'\n')
seen=set()
for x in sorted(res,key=lambda x:x['ratio']):
 key=x['text'],x['theme'],x['ratio']
 if key in seen:continue
 seen.add(key);print({k:x[k] for k in ['scene','theme','width','ratio','text','cls']})
 if len(seen)>=32:break
