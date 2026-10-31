import json,uuid,sys,time,pathlib,os
base=pathlib.Path.cwd()/'.loop-control/verification/storage-20261031'
id=uuid.uuid4().hex
cmd={'id':id,'action':sys.argv[1]}
if len(sys.argv)>2:cmd['label']=sys.argv[2]
tmp=base/'next-request.json';tmp.write_text(json.dumps(cmd));tmp.rename(base/'request.json')
path=base/('response-'+id+'.json')
if cmd['action']=='end':path=pathlib.Path.cwd()/'docs/verification/storage-layout-sqlite-20261031/cleanup.json'
for _ in range(300):
 if path.exists():
  value=json.loads(path.read_text());result=value.get('result',{});print(json.dumps({'ok':value.get('ok'),'revision':result.get('revision'),'projectSha256':result.get('projectSha256'),'nativeDocumentSha256':result.get('nativeDocumentSha256'),'result':{k:v for k,v in result.items() if k not in ['timelines','revision','projectSha256','nativeDocumentSha256']},'transforms':[[i.get('transform') for i in t['items'] if i['kind']=='video'] for t in result.get('timelines',[])]},ensure_ascii=False));break
 time.sleep(.2)
else:raise SystemExit('Control command timed out; inspect private error file')
