import type {ProductionWorkspace} from '../productionWorkspace';
import {uiText} from '../i18n/ui';
import {ImagePreview} from '../ui/media/ImagePreview';
import {completedReviewEvidence} from './completedReviewEvidence';

export function CompletedQualityEvidence({workspace:w,compact=false}:{workspace:ProductionWorkspace;compact?:boolean}){
 const notes=completedReviewEvidence(w),issues=w.exportIssues??[];
 if(!notes.length&&!issues.length)return null;
 const unresolved=issues.filter(i=>!i.resolved).length+notes.filter(n=>n.state!=='已替换').length;
 const labels=[...issues.filter(i=>!i.resolved).map(i=>i.reason),...notes.filter(n=>n.state!=='已替换').map(n=>n.shotId?uiText('字幕排版问题'):uiText('构图待核对'))];
 return <details className={`completed-quality${compact?' is-compact':''}`} open={!compact&&unresolved>0||undefined}>
  <summary>{uiText('问题与复核记录')} · {unresolved?`${unresolved} ${uiText('项未解决或待核对')}`:uiText('历史记录')}{compact&&labels.length>0&&<span className="completed-quality-summary"> · {[...new Set(labels)].join(' · ')}</span>}</summary>
  {issues.map(issue=><p key={issue.id}>{issue.reason} · {uiText(issue.resolved?'已解决':'未解决')}</p>)}
  {notes.map((note,index)=><div className="completed-quality-observation" key={index}><p>{note.shotId&&`${note.shotId} · `}{note.text} · {uiText(note.state)}</p><small>{uiText('来源：2026-11-16 实帧复核')} · {uiText('成片')} {note.exportSha256.slice(0,12)}</small>{note.image&&<details><summary>{uiText('查看抽帧证据')}</summary><ImagePreview src={note.image} alt={uiText('实帧复核证据')}/></details>}</div>)}
 </details>;
}
