export interface DeletionFileScope {
 files?:{path:string;bytes:number;authority:string}[];
 preserved?:{path:string;reason:string}[];
}
/** All permanent-delete entry points show the same server-confirmed file scope. */
export function EpisodeDeletionScope({files,preserved}:DeletionFileScope){return<>
 {files&&<details open><summary>将删除 {files.length} 个已登记文件</summary><ul className="episode-deletion-paths" aria-label="将删除的生产单文件">{files.map(file=><li key={file.path}><code>{file.path}</code></li>)}</ul></details>}
 {Boolean(preserved?.length)&&<details open><summary>保留 {preserved!.length} 项</summary><ul className="episode-deletion-paths" aria-label="保留的生产单文件">{preserved!.map(file=><li key={file.path}><code>{file.path}</code><small>{file.reason}</small></li>)}</ul></details>}
 </>;}
