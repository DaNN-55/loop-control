import {uiText} from '../i18n/ui';
import {formatFileSize} from '../fileSize';

export interface DeletionFileScope {
 files?:{path:string;bytes:number;authority:string}[];
 preserved?:{path:string;reason:string}[];
}
/** Summarize the server-confirmed plan; sizes describe files, not disk space reclaimed. */
export function EpisodeDeletionScope({files,preserved}:DeletionFileScope){
 if(!files&&!preserved?.length)return null;
 const groups=new Map<string,NonNullable<DeletionFileScope['preserved']>>();
 for(const item of preserved??[]){
  const group=groups.get(item.reason);
  if(group)group.push(item);else groups.set(item.reason,[item]);
 }
 return <section className="episode-deletion-scope" aria-label={uiText("文件范围摘要")}>
  {files&&<>
   <p className="episode-deletion-summary"><strong>{uiText("将删除 ")}{files.length}{uiText(" 个文件")}</strong><span>{uiText("共 ")}{formatFileSize(files.reduce((total,file)=>total+file.bytes,0))}</span></p>
   {files.length>0&&<details><summary>{uiText("查看文件明细")}</summary><ul className="episode-deletion-paths" aria-label={uiText("将删除的生产单文件")}>{files.map(file=><li key={file.path}><code>{file.path}</code><span className="episode-deletion-file-size">{formatFileSize(file.bytes)}</span></li>)}</ul></details>}
  </>}
  {Boolean(preserved?.length)&&<section className="episode-deletion-preserved" aria-label={uiText("保留内容")}>
   <h3>{uiText("保留 ")}{preserved!.length}{uiText(" 项")}</h3>
   {[...groups].map(([reason,items])=><details key={reason}><summary>{reason}<span className="episode-deletion-reason-count">{items.length}{uiText(" 项")}</span></summary><ul className="episode-deletion-paths" aria-label={reason}>{items.map(file=><li key={file.path}><code>{file.path}</code></li>)}</ul></details>)}
  </section>}
 </section>;
}
