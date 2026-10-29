#!/usr/bin/env python3
"""Exercise the actual scanner functions against synthetic local-only archives."""
import ast, collections, gzip, io, json, pathlib, re, tarfile, tempfile, zipfile
base=pathlib.Path(__file__).resolve().parent
source=ast.parse((base/'scan-content-closure.py').read_text())
body=[n for n in source.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef))]
ns={'__file__':str(base/'scan-content-closure.py')};exec(compile(ast.Module(body=body,type_ignores=[]),'scanner-functions','exec'),ns)
a='a'*64;b='b'*64;root='c'*64
with tempfile.TemporaryDirectory(dir=base,prefix='synthetic-scan-')as scratch:
 ns.update(PROJECT=pathlib.Path('/synthetic/project'),known={a,b,root},known_path_leaves={'child.json','child','kept.json','kept'},by_path=collections.defaultdict(set,{'src/child.json':{b},'.loop-control/kept.json':{a}}),path_cache={},stats=collections.Counter(),errors=[],graph=collections.defaultdict(set),edge_evidence={},scratch=pathlib.Path(scratch),CHUNK=32,MAX_EXPANDED=1024*1024,MAX_MEMBERS=100,MAX_DEPTH=20,ARCHIVE_EXTS={'.zip','.tar','.tgz','.gz','.gzip','.bz2','.xz','.7z','.rar','.zst','.zstd'},SHA_RE=re.compile(rb'(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])'),PATH_RE=re.compile(rb'(?:[A-Za-z0-9_.@~%/+:-]|[^\x00-\x7f]){1,4096}'))
 assert ns['path_targets']('./child.json',{'src/parent.ts'})=={b}
 assert ns['path_targets']('.loop-control/kept.json',set())=={a}
 assert ns['path_targets']('/synthetic/project/.loop-control/kept.json',set())=={a}
 text=b'prefix '+a.encode()+b' ./child.json end'
 archive=io.BytesIO()
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED)as z:z.writestr('src/parent.ts',text)
 tar=io.BytesIO()
 with tarfile.open(fileobj=tar,mode='w')as t:
  item=tarfile.TarInfo('nested.zip');payload=archive.getvalue();item.size=len(payload);t.addfile(item,io.BytesIO(payload))
 ns['inspect'](io.BytesIO(gzip.compress(tar.getvalue())),root,{'src/parent.ts'})
 assert ns['graph'][root]=={a,b}
 assert ns['stats']['archiveMembers']==3
 try:ns['inspect'](io.BytesIO(b'not-an-archive'),root,set(),expected_archive=True)
 except RuntimeError as error:assert str(error)=='archive-extension-without-readable-header'
 else:raise AssertionError('Unreadable archives must fail closed')
 result={'passed':True,'cases':['relative-logical-path','dot-prefixed-logical-path','absolute-project-path','sha-token','nested-gzip-tar-zip-member','unreadable-archive-fails-closed'],'members':ns['stats']['archiveMembers']}
 (base/'scanner-selftest.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
