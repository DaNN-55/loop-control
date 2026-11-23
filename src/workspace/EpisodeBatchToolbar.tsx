import {ChevronDown,Download,List,Trash2} from 'lucide-react';
import {uiText} from '../i18n/ui';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Dropdown} from '../ui/dan-ui/components/base/dropdown/dropdown';
import type {EpisodeBatchAction,EpisodeBatchSelectionItem} from './EpisodeBatch';

const reviewActions=[
 {id:'script-review',hint:'script',label:'确认脚本'},
 {id:'export-review',hint:'export',label:'确认成片'},
] as const;
const managementLabels:Record<string,string>={rename:'改名','move-collection':'调整系列',folders:'查看文件夹'};

export function EpisodeBatchToolbar({selection,actions,onOpen,onClear}:{
 selection:readonly EpisodeBatchSelectionItem[];
 actions:readonly EpisodeBatchAction[];
 onOpen:(id:string)=>void;
 onClear:()=>void;
}){
 const available=new Map(actions.map(action=>[action.id,action]));
 const reviews=reviewActions.filter(action=>available.has(action.id)&&selection.some(item=>!item.archived&&
  (item.hints?.[action.hint]??(action.hint==='script'?item.stage==='waiting_input':item.stage!=='waiting_input'&&item.stage!=='production_completed'))));
 const showZip=available.has('publication-download')&&selection.some(item=>item.stage==='production_completed'&&(item.hints?.zip??true));
 const archive=available.has('archive')&&selection.some(item=>!item.archived);
 const unarchive=available.has('unarchive')&&selection.some(item=>item.archived);
 const recycle=available.has('recycle');
 const handled=new Set([...reviewActions.map(action=>action.id),'publication-download','archive','unarchive','recycle']);
 const management=actions.filter(action=>!handled.has(action.id));
 const count=uiText('已选 {count} 张',{count:selection.length});
 const hasManagement=management.length>0;
 return <div className="episode-batch-toolbar episode-batch-selection-toolbar" role="group" aria-label={uiText('批量操作')}>
  <Button size="sm" color="tertiary" className="episode-batch-selection-count" iconTrailing={List}
   aria-label={uiText('查看选中的 {count} 张生产单',{count:selection.length})} onPress={()=>onOpen('selection')}>{count}</Button>
  <span className="sr-only" role="status">{count}</span>
  <div className="episode-batch-selection-actions">
   {showZip&&<Button size="sm" color="secondary" iconLeading={Download} onPress={()=>onOpen('publication-download')}>{uiText('下载发布 ZIP')}</Button>}
   {(reviews.length>0||hasManagement||archive||unarchive||recycle)&&<Dropdown.Root>
    <Button size="sm" color="tertiary" iconTrailing={ChevronDown}>{uiText('批量操作')}</Button>
    <Dropdown.Popover className="dan-ui product-ui episode-batch-action-popover" placement="bottom start">
     <Dropdown.Menu aria-label={uiText('批量操作')}>
      {reviews.length>0&&<>
       <Dropdown.Section>
        <Dropdown.SectionHeader className="episode-batch-action-heading">{uiText('审批')}</Dropdown.SectionHeader>
        {reviews.map(action=><Dropdown.Item key={action.id} id={action.id} onAction={()=>onOpen(action.id)}>{uiText(action.label)}</Dropdown.Item>)}
       </Dropdown.Section>
       {(hasManagement||archive||unarchive||recycle)&&<Dropdown.Separator/>}
      </>}
      {hasManagement&&<Dropdown.Section>
       {management.map(action=><Dropdown.Item key={action.id} id={action.id} onAction={()=>onOpen(action.id)}>{managementLabels[action.id]?uiText(managementLabels[action.id]):action.label}</Dropdown.Item>)}
      </Dropdown.Section>}
      {(archive||unarchive)&&<>
       {hasManagement&&<Dropdown.Separator/>}
       <Dropdown.Section>
        {archive&&<Dropdown.Item id="archive" onAction={()=>onOpen('archive')}>{uiText('归档')}</Dropdown.Item>}
        {unarchive&&<Dropdown.Item id="unarchive" onAction={()=>onOpen('unarchive')}>{uiText('取消归档')}</Dropdown.Item>}
       </Dropdown.Section>
      </>}
      {recycle&&<>
       {(hasManagement||archive||unarchive)&&<Dropdown.Separator/>}
       <Dropdown.Item id="recycle" icon={Trash2} className="menu-item-danger" onAction={()=>onOpen('recycle')}>{uiText('移入回收站')}</Dropdown.Item>
      </>}
     </Dropdown.Menu>
    </Dropdown.Popover>
   </Dropdown.Root>}
  </div>
  <Button size="sm" color="tertiary" className="episode-batch-selection-clear" aria-label={uiText('清空选择')} onPress={onClear}>{uiText('清空')}</Button>
 </div>;
}
