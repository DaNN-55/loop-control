"""Acceptance-only observer. Calls the original WhisperX functions unchanged."""
import sys,os,json,time,runpy,hashlib
from pathlib import Path
run=Path(__file__).resolve().parent
if not (run/'preparation-sealed.json').is_file():raise RuntimeError('Downloads are not sealed; inference prohibited')
cache=run/'volume/media/whisperx-models';trace=run/'python-audit'/('python-'+str(os.getpid())+'.jsonl');denied=0
def record(event,**values):
 with trace.open('a') as f:f.write(json.dumps({'event':event,'pid':os.getpid(),'at':time.time(),**values},ensure_ascii=False)+'\n')
def audit(event,args):
 global denied
 if event in ('socket.connect','socket.getaddrinfo','socket.gethostbyname','socket.gethostbyaddr','socket.sendto'):
  denied+=1;record('network-denied',auditEvent=event);raise PermissionError('Offline inference forbids all network')
sys.addaudithook(audit)
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',DO_NOT_TRACK='1',NLTK_DATA=str(cache/'nltk_data'),NUMBA_CACHE_DIR=str(run/'numba-cache'),TORCH_HOME=str(cache/'torch'),TOKENIZERS_PARALLELISM='false')
record('installed',python=sys.version.split()[0],osNetworkSandbox=True,hfOffline=True)
if (run/'diagnostic-stack').exists():
 import faulthandler
 faulthandler.dump_traceback_later(8,repeat=True)
import whisperx
original_load,original_align=whisperx.load_align_model,whisperx.align
def load(*args,**kwargs):
 start=time.monotonic();record('load-align-model-start',model=kwargs.get('model_name'),cacheOnly=kwargs.get('model_cache_only'),device=kwargs.get('device'))
 value=original_load(*args,**kwargs)
 record('load-align-model-end',seconds=time.monotonic()-start,modelClass=type(value[0]).__name__,parameters=sum(p.numel() for p in value[0].parameters()),language=value[1].get('language'),pipelineType=value[1].get('type'),networkDenied=denied)
 return value
def align(*args,**kwargs):
 start=time.monotonic();record('align-start',returnCharAlignments=kwargs.get('return_char_alignments'))
 value=original_align(*args,**kwargs);chars=[c for s in value.get('segments',[]) for c in s.get('chars',[])];timed=[c for c in chars if c.get('start') is not None and c.get('end') is not None];scores=[float(c['score']) for c in timed if c.get('score') is not None]
 raw=json.dumps(value,ensure_ascii=False,default=float);(run/'python-audit'/('alignment-'+str(os.getpid())+'.json')).write_text(raw+'\n')
 record('align-end',seconds=time.monotonic()-start,chars=len(chars),timedChars=len(timed),minScore=min(scores) if scores else None,meanScore=sum(scores)/len(scores) if scores else None,rawSha256=hashlib.sha256(raw.encode()).hexdigest(),networkDenied=denied)
 if (run/'hold-after-align').exists():
  record('controlled-return-gate',noResultSubstitution=True)
  while (run/'hold-after-align').exists():time.sleep(0.05)
 return value
whisperx.load_align_model,whisperx.align=load,align
sys.argv=sys.argv[1:]
if not sys.argv:raise RuntimeError('Runner required')
runpy.run_path(sys.argv[0],run_name='__main__')
record('runner-returned',networkDenied=denied)
