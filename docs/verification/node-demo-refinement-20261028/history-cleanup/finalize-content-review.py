#!/usr/bin/env python3
"""Bind supplemental read-only findings without merging unknown holds into proven dependencies."""
from pathlib import Path
import hashlib,json
BASE=Path(__file__).resolve().parent
read=lambda name:json.loads((BASE/name).read_text())
retained=read('final-retained-shas.json');summary=retained['summary'];assert summary['auditMethodVersion']==2
salvage=read('orphan-zip-local-header-review.json');explanation=read('protection-hash-explanation.json');errors=read('scan-errors.json');held=read('held-physical.json');eligible=read('eligible-physical.json')
assert not salvage['references'],'New salvage dependencies require a new graph closure before delivery'
assert len(explanation['protections'])==12 and all(x['protectedFileHashMatches']and x['descriptorContainsOriginalSha']and x['descriptorContainsProtectedSha']for x in explanation['protections'])
protected={r['originalSha256']for r in explanation['protections']};notices=[];blocking=[]
for error in errors['errors']:
 if error['reason']=='physical-content-hash-mismatch'and error['source']in protected:
  notices.append({**error,'reason':'explained-protection-descriptor','blocking':False,'explanationEvidence':'protection-hash-explanation.json'})
 else:blocking.append(error)
assert len(blocking)==1 and blocking[0]['source']==salvage['sourceSha256']
summary['scanErrors']=len(blocking);summary['integrityNotices']=len(notices);summary['retainedScanErrors']=len(blocking)
summary['scanning'].update(salvageArchiveMembers=salvage['membersRead'],salvageMembersCompleteCRCVerified=sum(x['memberCompleteAndCRCVerified']for x in salvage['members']),salvageExpandedBytes=salvage['expandedBytesRead'],salvageCompressedBytes=salvage['compressedBytesRead'],unknownArchiveRemainderBytes=salvage['unknownRemainderBytes'])
summary['supplementalEvidenceSha256']={name:hashlib.sha256((BASE/name).read_bytes()).hexdigest()for name in ['scanner-selftest.json','protection-context-review.json','protection-hash-explanation.json','orphan-zip-local-header-review.json']}
summary['finalReviewScriptSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
summary['scopeSeparation']='retainedShas contains proven roots and observed transitive references only; unknown ZIP dependencies add physical holds, never inferred metadata retention.'
assert not eligible['files'] and len(held['files'])==summary['candidateCount']
for row in held['files']:
 assert'retained-dependency-scan-incomplete-global-hold'in row['reasons']
 row['blockedByArchiveSha256']=salvage['sourceSha256']
 if'content-address-name-mismatch'in row['reasons']and row['sha256']in protected:row['reasons']=[('explained-protection-descriptor'if x=='content-address-name-mismatch'else x)for x in row['reasons']]
errors.update(errors=blocking,notices=notices,retainedDependencyErrors=blocking)
for name,value in [('final-retained-shas.json',retained),('eligible-physical.json',eligible),('held-physical.json',held),('scan-errors.json',errors),('content-reference-graph.json',read('content-reference-graph.json')),('runtime-descriptor-review.json',read('runtime-descriptor-review.json'))]:
 value['summary']=summary;(BASE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
assert set(retained['retainedShas']).isdisjoint({r['sha256']for r in eligible['files']})
print(json.dumps({k:summary[k]for k in ['auditMethodVersion','candidateCount','actualFiles','actualBytes','retainedCount','indirectRetainedCount','eligiblePhysicalCount','heldCount','scanErrors','integrityNotices','scanning']}))
