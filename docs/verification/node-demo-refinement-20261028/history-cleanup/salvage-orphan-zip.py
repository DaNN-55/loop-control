#!/usr/bin/env python3
"""One bounded local-header decode attempt; any unknown remainder stays blocking."""
from pathlib import Path
import ast, collections, hashlib, io, json, struct, tempfile, time, zlib
BASE=Path(__file__).resolve().parent
source=(BASE/'scan-content-closure.py').read_text().split('# Verify exactly the fixed inventory before scanning.')[0]
ns={'__file__':str(BASE/'scan-content-closure.py')};exec(compile(source,'scanner-setup','exec'),ns)
sha='84ab728c84a9654414bcfdec8d38403e4e927bdd61ee11c80793b5f432078d48';path=ns['CONTENT']/sha
started=time.monotonic();MAX_COMPRESSED=64*1024*1024;MAX_EXPANDED=128*1024*1024;MAX_MEMBERS=512;MAX_SECONDS=45
members=[];stop=None;compressed=expanded=0
with tempfile.TemporaryDirectory(dir=BASE,prefix='zip-local-header-')as scratch:
 ns['scratch']=Path(scratch)
 with path.open('rb')as stream:
  while stream.tell()<path.stat().st_size:
   offset=stream.tell()
   if len(members)>=MAX_MEMBERS or compressed>=MAX_COMPRESSED or expanded>=MAX_EXPANDED or time.monotonic()-started>MAX_SECONDS:stop={'reason':'bounded-read-limit','offset':offset};break
   header=stream.read(30)
   if len(header)<30 or header[:4]!=b'PK\x03\x04':stop={'reason':'local-header-not-decodable','offset':offset};break
   version,flags,method,mtime,mdate,crc,csize,usize,nlen,xlen=struct.unpack('<HHHHHIIIHH',header[4:])
   name=stream.read(nlen);extra=stream.read(xlen)
   if len(name)!=nlen or len(extra)!=xlen:stop={'reason':'truncated-local-header','offset':offset};break
   filename=name.decode('utf8'if flags&0x800 else'cp437',errors='replace');name_sha=hashlib.sha256(name).hexdigest()
   if flags&1:stop={'reason':'encrypted-member','offset':offset,'memberNameSha256':name_sha};break
   if csize==0xffffffff or usize==0xffffffff:stop={'reason':'zip64-member-requires-further-decoding','offset':offset,'memberNameSha256':name_sha};break
   if method not in (0,8):stop={'reason':'unsupported-member-compression','method':method,'offset':offset,'memberNameSha256':name_sha};break
   body=bytearray();raw_read=0;complete=False;failure=None
   if method==8:
    decoder=zlib.decompressobj(-15)
    while True:
     remaining=MAX_COMPRESSED-compressed-raw_read
     room=MAX_EXPANDED-expanded-len(body)
     if remaining<=0 or room<=0 or time.monotonic()-started>MAX_SECONDS:failure='bounded-member-read-limit';break
     readsize=min(65536,remaining,csize-raw_read if csize else 65536)
     if readsize<=0:failure='declared-compressed-size-exhausted-before-eof';break
     chunk=stream.read(readsize)
     if not chunk:failure='truncated-compressed-member';break
     raw_read+=len(chunk)
     try:body.extend(decoder.decompress(chunk,room+1))
     except zlib.error:failure='deflate-decoding-error';break
     if len(body)>MAX_EXPANDED-expanded:failure='expanded-byte-limit';break
     if decoder.eof:
      stream.seek(-len(decoder.unused_data),1);raw_read-=len(decoder.unused_data);complete=True;break
   elif flags&8 and csize==0:
    search_from=0
    while raw_read<MAX_COMPRESSED-compressed and expanded+len(body)<MAX_EXPANDED:
     chunk=stream.read(min(65536,MAX_COMPRESSED-compressed-raw_read,MAX_EXPANDED-expanded-len(body)))
     if not chunk:failure='stored-member-missing-data-descriptor';break
     body.extend(chunk);raw_read+=len(chunk)
     position=body.find(b'PK\x07\x08',search_from)
     while position>=0:
      if position+16>len(body):break
      dcrc,dcsize,dusize=struct.unpack('<III',body[position+4:position+16])
      if dcsize==position and dusize==position and zlib.crc32(body[:position])&0xffffffff==dcrc:
       stream.seek(-(len(body)-position),1);del body[position:];raw_read=position;complete=True;break
      position=body.find(b'PK\x07\x08',position+1)
     if complete:break
     search_from=max(0,len(body)-16)
     if time.monotonic()-started>MAX_SECONDS:failure='stored-member-time-limit';break
    if not complete and not failure:failure='stored-member-descriptor-not-found-within-read-bound'
   else:
    take=min(csize,MAX_COMPRESSED-compressed,MAX_EXPANDED-expanded);body.extend(stream.read(take));raw_read=len(body);complete=raw_read==csize
    if not complete:failure='stored-member-read-limit-or-truncation'
   compressed+=raw_read;expanded+=len(body)
   if flags&8 and complete:
    descriptor=stream.read(4)
    if descriptor==b'PK\x07\x08':descriptor=stream.read(12)
    else:descriptor+=stream.read(8)
    if len(descriptor)!=12:failure='truncated-data-descriptor';complete=False
    else:crc,csize,usize=struct.unpack('<III',descriptor)
   if complete and(csize!=raw_read or usize!=len(body)or zlib.crc32(body)&0xffffffff!=crc):failure='local-member-integrity-mismatch';complete=False
   for target in ns['path_targets'](filename,set()):
    ns['graph'][sha].add(target);ns['edge_evidence'].setdefault((sha,target),'salvaged-archive-member-logical-path')
   nested_error=None
   try:ns['inspect'](io.BytesIO(body),sha,{filename},member=filename)
   except Exception as error:
    nested_error=type(error).__name__;ns['scan_plain'](io.BytesIO(body),sha,{filename})
   members.append({'offset':offset,'memberNameSha256':name_sha,'extension':Path(filename).suffix.lower(),'compressionMethod':method,'compressedBytesRead':raw_read,'expandedBytesRead':len(body),'memberCompleteAndCRCVerified':complete,'nestedScanErrorClass':nested_error})
   if failure or nested_error:stop={'reason':failure or'nested-member-scan-incomplete','offset':stream.tell(),'memberNameSha256':name_sha};break
  final_offset=stream.tell()
result={'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'readOnly':True,'sourceSha256':sha,'sourceBytes':path.stat().st_size,'logicalContexts':0,'logicalContextEvidence':'protection-context-review.json confirmed no history_files row for this SHA','bounds':{'compressedBytes':MAX_COMPRESSED,'expandedBytes':MAX_EXPANDED,'members':MAX_MEMBERS,'seconds':MAX_SECONDS},'elapsedSeconds':round(time.monotonic()-started,2),'compressedBytesRead':compressed,'expandedBytesRead':expanded,'membersRead':len(members),'scanEndOffset':final_offset,'unknownRemainderBytes':path.stat().st_size-final_offset,'complete':False,'unknownDependencyHoldRequired':True,'stop':stop or{'reason':'missing-central-directory-or-archive-end'},'members':members,'references':[{'sha256':target,'kind':ns['edge_evidence'].get((sha,target),'salvaged-member-body-reference')}for target in sorted(ns['graph'][sha])],'limits':'Only complete local member CRCs prove member completeness; unknown remaining bytes and missing central directory remain held. No claim that recovered local members exhaust the archive.'}
(BASE/'orphan-zip-local-header-review.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k]for k in ['membersRead','compressedBytesRead','expandedBytesRead','unknownRemainderBytes','stop','references']}))
