#!/usr/bin/env python3
"""Read-only physical-content dependency audit; never prints or stores file bodies."""
from pathlib import Path
import collections, gzip, hashlib, io, json, os, posixpath, re, shutil, stat, tarfile, tempfile, time, urllib.parse, zipfile
BASE=Path(__file__).resolve().parent
PROJECT=BASE.parents[3]
RUNTIME=PROJECT/'.loop-control/local'
CONTENT=RUNTIME/'history/content'
START=time.time()
SHA_RE=re.compile(rb'(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])')
PATH_RE=re.compile(rb'(?:[A-Za-z0-9_.@~%/+:-]|[^\x00-\x7f]){1,4096}')
ARCHIVE_EXTS={'.zip','.tar','.tgz','.gz','.gzip','.bz2','.xz','.7z','.rar','.zst','.zstd'}
CHUNK=1024*1024
MAX_DEPTH=20
MAX_MEMBERS=1000000
MAX_EXPANDED=128*1024**3
inputs={name:(BASE/name).read_bytes()for name in ['manifest.json','file-links.json','retention-files-direct.json','retention-version-closure.json','before/content-inventory.json']}
data={k:json.loads(v)for k,v in inputs.items()}
manifest=data['manifest.json']; links=data['file-links.json']; direct=data['retention-files-direct.json']; closure=data['retention-version-closure.json']; inventory=data['before/content-inventory.json']
candidates={r['sha256']:r for r in manifest['files']}
actual={r['name']:r for r in inventory}
assert all(re.fullmatch('[a-f0-9]{64}',x)for x in actual)
assert json.loads((RUNTIME/'deployment.json').read_text())['runtimeRoot']==str(RUNTIME)
known=set(actual)|set(candidates)
by_path=collections.defaultdict(set); contexts=collections.defaultdict(set); extensions=collections.defaultdict(set)
def norm(path):
    path=urllib.parse.unquote(path).replace('\\/','/').replace('\\\\','/')
    if path.startswith('file://'):path=path[7:]
    if path.startswith(str(PROJECT)+'/'):path=path[len(str(PROJECT))+1:]
    return posixpath.normpath(path)
def aliases(path):
    p=norm(path);result={p}
    prefix='.loop-control/archives/worktrees/'
    if p.startswith(prefix)and'/'in p[len(prefix):]:result.add(p[len(prefix):].split('/',1)[1])
    return result
for row in links+direct:
    sha=row['sha256'];p=row['logical_path']
    for alias in aliases(p):by_path[alias].add(sha);contexts[sha].add(alias)
    extensions[sha].add(Path(p).suffix.lower())
for row in manifest['files']:
    for p in row.get('logical_paths',[]):
        for alias in aliases(p):by_path[alias].add(row['sha256']);contexts[row['sha256']].add(alias)
        extensions[row['sha256']].add(Path(p).suffix.lower())
known_path_leaves={posixpath.basename(p)for p in by_path}|{Path(p).stem for p in by_path}
path_cache={}
def path_targets(token,source_contexts):
    token=token.rstrip(',;!?')
    if not token or token.startswith(('http://','https://','keychain:','data:')):return set()
    if posixpath.basename(norm(token))not in known_path_leaves:return set()
    if '/'not in token and not token.startswith('.') and '.'not in token:return set()
    k=(token,tuple(sorted(source_contexts)))
    if k in path_cache:return path_cache[k]
    paths=aliases(token)
    if not token.startswith('/'):
        for context in source_contexts:paths.add(norm(posixpath.join(posixpath.dirname(context),token)))
    targets=set()
    for p in paths:
        targets.update(by_path.get(p,()))
        if token.startswith('.')and not Path(p).suffix:
            for ext in ['.ts','.tsx','.mjs','.js','.json','/index.ts','/index.tsx','/index.js']:targets.update(by_path.get(p+ext,()))
    if len(path_cache)<200000:path_cache[k]=targets
    return targets&known
stats=collections.Counter(); errors=[]; file_results={}; graph=collections.defaultdict(set); edge_evidence={}
scratch=BASE/'scan-scratch';scratch.mkdir(exist_ok=True)
def add_error(source,reason,member=None):
    entry={'source':source,'reason':reason}
    if member:entry['memberNameSha256']=hashlib.sha256(member.encode('utf8','surrogatepass')).hexdigest()
    errors.append(entry)
def scan_plain(stream,source,source_contexts,prefix=b'',member=None):
    tail=b'';local_bytes=0
    while True:
        chunk=prefix if prefix else stream.read(CHUNK);prefix=b''
        if not chunk:break
        local_bytes+=len(chunk);stats['scannedExpandedBytes']+=len(chunk)
        if stats['scannedExpandedBytes']>MAX_EXPANDED:raise RuntimeError('expanded-byte-limit')
        body=tail+chunk
        for match in SHA_RE.finditer(body):
            target=match[0].decode().lower()
            if target in known and target!=source:graph[source].add(target);edge_evidence.setdefault((source,target),'sha256-token')
        for match in PATH_RE.finditer(body):
            raw=match[0]
            if b'/'not in raw and b'.'not in raw:continue
            try:token=raw.decode('utf8')
            except UnicodeDecodeError:continue
            for target in path_targets(token,source_contexts):
                if target!=source:graph[source].add(target);edge_evidence.setdefault((source,target),'logical-path')
        tail=body[-8192:]
    return local_bytes

def archive_kind(prefix):
    if prefix.startswith((b'PK\x03\x04',b'PK\x05\x06',b'PK\x07\x08')):return'zip'
    if prefix.startswith(b'\x1f\x8b'):return'gzip'
    if len(prefix)>=512:
        try:
            info=tarfile.TarInfo.frombuf(prefix[:512],'utf8','surrogateescape')
            if info.name:return'tar'
        except (tarfile.TarError,ValueError):pass
    if prefix.startswith((b'7z\xbc\xaf\x27\x1c',b'Rar!',b'BZh',b'\xfd7zXZ',b'\x28\xb5\x2f\xfd')):return'unsupported'
    return None

def inspect(stream,source,source_contexts,depth=0,member=None,expected_archive=False):
    if depth>MAX_DEPTH:raise RuntimeError('nested-depth-limit')
    prefix=stream.read(512);kind=archive_kind(prefix)
    if kind=='unsupported':raise RuntimeError('unsupported-compressed-archive')
    if not kind:
        if expected_archive:raise RuntimeError('archive-extension-without-readable-header')
        return scan_plain(stream,source,source_contexts,prefix,member)
    stats['archiveContainers']+=1
    # Only scratch copies of nested archive bytes are written. Original content stays read-only.
    with tempfile.TemporaryFile(dir=scratch) as copied:
        copied.write(prefix)
        shutil.copyfileobj(stream,copied,CHUNK);copied.seek(0)
        if kind=='zip':
            with zipfile.ZipFile(copied)as archive:
                for entry in archive.infolist():
                    if entry.is_dir():continue
                    stats['archiveMembers']+=1
                    if stats['archiveMembers']>MAX_MEMBERS:raise RuntimeError('member-count-limit')
                    for target in path_targets(entry.filename,source_contexts):
                        if target!=source:graph[source].add(target);edge_evidence.setdefault((source,target),'archive-member-logical-path')
                    if entry.flag_bits&1:raise RuntimeError('encrypted-zip-member')
                    nested_contexts=set(source_contexts)|{norm(entry.filename)}
                    with archive.open(entry)as content:inspect(content,source,nested_contexts,depth+1,entry.filename,Path(entry.filename).suffix.lower()in ARCHIVE_EXTS)
        elif kind=='tar':
            with tarfile.open(fileobj=copied,mode='r|')as archive:
                for entry in archive:
                    stats['archiveMembers']+=1
                    if stats['archiveMembers']>MAX_MEMBERS:raise RuntimeError('member-count-limit')
                    for name in [entry.name,entry.linkname]:
                        for target in path_targets(name,source_contexts):
                            if target!=source:graph[source].add(target);edge_evidence.setdefault((source,target),'archive-member-logical-path')
                    if entry.isfile():
                        content=archive.extractfile(entry)
                        if content:
                            with content:inspect(content,source,set(source_contexts)|{norm(entry.name)},depth+1,entry.name,Path(entry.name).suffix.lower()in ARCHIVE_EXTS)
                    elif not(entry.isdir()or entry.issym()or entry.islnk()):raise RuntimeError('unsupported-tar-special-member')
        elif kind=='gzip':
            stats['archiveMembers']+=1
            with gzip.GzipFile(fileobj=copied)as content:inspect(content,source,source_contexts,depth+1,member)

# Verify exactly the fixed inventory before scanning.
now={p.name:p for p in CONTENT.iterdir()}
if set(now)!=set(actual):raise RuntimeError('physical-inventory-name-drift')
for i,(sha,item)in enumerate(sorted(actual.items()),1):
    path=now[sha];st=path.lstat()
    if not stat.S_ISREG(st.st_mode)or st.st_ino!=item['ino']or st.st_dev!=item['dev']or st.st_size!=item['bytes']:raise RuntimeError('physical-inventory-identity-drift')
    before_errors=len(errors)
    try:
        digest=hashlib.sha256()
        with path.open('rb')as stream:
            while chunk:=stream.read(CHUNK):digest.update(chunk);stats['hashedBytes']+=len(chunk)
        hash_matches=digest.hexdigest()==sha
        if not hash_matches:
            add_error(sha,'physical-content-hash-mismatch');errors[-1].update(blocking=False,actualSha256=digest.hexdigest())
        with path.open('rb')as stream:inspect(stream,sha,contexts.get(sha,set()),expected_archive=bool(extensions[sha]&ARCHIVE_EXTS))
        file_results[sha]={'scanComplete':True,'hashMatchesName':hash_matches,'bytes':st.st_size,'references':len(graph[sha])}
    except Exception as cause:
        reason=str(cause)if isinstance(cause,RuntimeError)else type(cause).__name__
        # Raw exception messages can include payload values; record classes only.
        add_error(sha,reason)
        # Raw bytes remain useful evidence even when the archive cannot be decoded.
        with path.open('rb')as stream:scan_plain(stream,sha,contexts.get(sha,set()))
        file_results[sha]={'scanComplete':False,'bytes':st.st_size,'references':len(graph[sha])}
    if i%500==0:print(json.dumps({'filesScanned':i,'total':len(actual),'expandedBytes':stats['scannedExpandedBytes'],'members':stats['archiveMembers'],'errors':len(errors),'elapsedSeconds':round(time.time()-START)}),flush=True)

# Operational descriptor roots; no raw body is persisted.
descriptors=[]
for name in ['deployment.json','app.json','initial-import-private.json','secret-index.json','volume/restore-receipt.json']:
    p=RUNTIME/name
    if p.is_file():descriptors.append(p)
for folder in ['state','imports']:
    for p in (RUNTIME/folder).rglob('*'):
        if p.is_file()and not p.is_symlink()and p.suffix.lower()in{'.json','.jsonl','.md','.yaml','.yml','.toml','.txt'}:descriptors.append(p)
for p in descriptors:
    source='runtime:'+str(p.relative_to(RUNTIME))
    try:
        with p.open('rb')as stream:inspect(stream,source,{str(p.relative_to(PROJECT))})
        stats['runtimeDescriptors']+=1;stats['runtimeDescriptorBytes']+=p.stat().st_size
    except Exception as cause:add_error(source,str(cause)if isinstance(cause,RuntimeError)else type(cause).__name__)
provenance=[]
for name in ['history/integration-report.json','history/supplemental-report.json']:
    p=RUNTIME/name
    if p.is_file():
        source='provenance:'+name
        with p.open('rb')as stream:inspect(stream,source,{str(p.relative_to(PROJECT))})
        provenance.append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'referencedKnownContentCount':len(graph[source]),'excludedAsRootReason':'Historical import provenance report, written by history-consolidation.mjs; not read as operational content/restore dependency. Approved source deletion scope must not recursively root the original import manifest. Report retained unchanged.'})
roots=collections.defaultdict(set)
for sha in set(actual)-set(candidates):roots[sha].add('outside-approved-candidate-scope')
for row in direct:roots[row['sha256']].add('direct:'+row.get('retention_reason','retained-reference'))
for sha in closure['retainedPayloadShaReferences']:
    if sha in known:roots[sha].add('retained-historical-payload-reference')
for p in descriptors:
    source='runtime:'+str(p.relative_to(RUNTIME))
    for sha in graph[source]:roots[sha].add(source)
retained=set(roots);why={sha:{'reason':sorted(reasons)}for sha,reasons in roots.items()};queue=collections.deque(sorted(retained))
while queue:
    source=queue.popleft()
    for sha in sorted(graph[source]):
        if sha not in retained:retained.add(sha);queue.append(sha);why[sha]={'reason':['indirect-content-reference'],'via':source,'referenceKind':edge_evidence[(source,sha)]}
retained_errors=[e for e in errors if e.get('blocking',True)and(e['source']in retained or e['source'].startswith('runtime:'))]
held=[];eligible=[]
for sha,item in sorted(candidates.items()):
    reasons=[]
    if sha in retained:reasons.extend(why[sha]['reason'])
    if not file_results.get(sha,{}).get('scanComplete'):reasons.append('candidate-scan-incomplete')
    if file_results.get(sha,{}).get('hashMatchesName')is False:reasons.append('content-address-name-mismatch')
    if retained_errors:reasons.append('retained-dependency-scan-incomplete-global-hold')
    row={'sha256':sha,'bytes':actual.get(sha,{}).get('bytes',item['bytes'])}
    if reasons:held.append({**row,'reasons':reasons,**({'via':why[sha].get('via'),'referenceKind':why[sha].get('referenceKind')}if sha in why and'via'in why[sha]else{})})
    else:eligible.append(row)
summary={'auditMethodVersion':2,'auditScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'elapsedSeconds':round(time.time()-START,2),'readOnly':True,'root':str(CONTENT),'candidateCount':len(candidates),'candidateBytes':sum(r['bytes']for r in candidates.values()),'actualFiles':len(actual),'actualBytes':sum(r['bytes']for r in actual.values()),'retainedCount':len(retained),'rootCount':len(roots),'indirectRetainedCount':len(retained-set(roots)),'eligiblePhysicalCount':len(eligible),'eligiblePhysicalBytes':sum(r['bytes']for r in eligible),'heldCount':len(held),'scanErrors':len(errors),'retainedScanErrors':len(retained_errors),'scanning':dict(stats),'inputSha256':{k:hashlib.sha256(v).hexdigest()for k,v in inputs.items()},'unresolvedHistoricalPayloadShaTokens':sorted(set(closure['retainedPayloadShaReferences'])-known),'logicalPathPolicy':'Exact normalized original path, source-tree stripped alias and context-relative path; ambiguous matches retain every matching SHA; explicit local imports resolve source extensions. No basename-only global lookup.','archivePolicy':'Magic and logical extension detection; recursive ZIP/TAR/gzip member inspection; no extraction to runtime; unsupported/encrypted/corrupt/limited retained archive triggers global candidate hold.'}
def write(name,value):(BASE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
write('final-retained-shas.json',{'summary':summary,'retainedShas':sorted(retained),'retained':[{'sha256':sha,**why[sha]}for sha in sorted(retained)],'roots':[{'sha256':sha,'reasons':sorted(reasons)}for sha,reasons in sorted(roots.items())]})
write('eligible-physical.json',{'summary':summary,'files':eligible})
write('held-physical.json',{'summary':summary,'files':held})
write('scan-errors.json',{'summary':summary,'errors':errors,'retainedDependencyErrors':retained_errors})
write('content-reference-graph.json',{'summary':summary,'edges':[{'from':source,'to':target,'kind':edge_evidence.get((source,target),'sha256-token')}for source in sorted(graph)for target in sorted(graph[source])],'files':[{'sha256':sha,**result}for sha,result in sorted(file_results.items())]})
write('runtime-descriptor-review.json',{'summary':summary,'operationalRoots':[{'path':str(p),'bytes':p.stat().st_size,'referencedKnownContentCount':len(graph['runtime:'+str(p.relative_to(RUNTIME))])}for p in descriptors],'provenanceOnly':provenance})
scratch.rmdir()
assert all(hashlib.sha256((BASE/name).read_bytes()).hexdigest()==summary['inputSha256'][name]for name in inputs),'audit input drift'
print(json.dumps(summary,ensure_ascii=False),flush=True)
