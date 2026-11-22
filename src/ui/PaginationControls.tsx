import {uiText} from '../i18n/ui';
import {Button} from './dan-ui/components/base/buttons/button';
import {Fragment,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
interface PaginationControlsProps {
  label?: string;
  numbered?: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeControl?: ReactNode;
}

export function PaginationControls({ numbered=false, label = "分页", page, pageSize, total, onPageChange, pageSizeControl }: PaginationControlsProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if(numbered){
    // Keep the first/last and adjacent pages without allocating the entire catalog's range.
    const pages=[...new Set([1,page-1,page,page+1,pageCount].filter(value=>value>=1&&value<=pageCount))].sort((a,b)=>a-b);
    return <nav aria-label={uiText(label)} className="pagination-controls pagination-controls-numbered">
      <span className="pagination-total">{uiText("共 ")}{total}{uiText(" 条")}</span>
      {pageSizeControl}
      <div className="pagination-pages">
        <Button size="sm" color="secondary" iconLeading={ChevronLeft} aria-label={uiText("上一页")} isDisabled={page<=1} onPress={()=>onPageChange(page-1)}/>
        {pages.map((number,index)=><Fragment key={number}>
          {index>0&&number-pages[index-1]>1&&<span className="pagination-gap" aria-hidden="true">…</span>}
          <Button size="sm" color="secondary" className="pagination-page" aria-label={`${uiText("第 ")}${number}${uiText(" 页")}`} aria-current={number===page?'page':undefined} isDisabled={total===0} onPress={()=>{if(number!==page)onPageChange(number);}}>{number}</Button>
        </Fragment>)}
        <Button size="sm" color="secondary" iconLeading={ChevronRight} aria-label={uiText("下一页")} isDisabled={page>=pageCount} onPress={()=>onPageChange(page+1)}/>
      </div>
    </nav>;
  }
  if (pageCount <= 1 && !pageSizeControl) return null;
  return <nav aria-label={uiText(label)} className="pagination-controls">
    <span>{uiText("第 ")}{page} / {pageCount}{uiText(" 页 · 共 ")}{total}{uiText(" 条")}</span>
    <div>
      <Button size="sm" color="secondary" className="button button-secondary" isDisabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} type="button">{uiText("上一页")}</Button>
      {pageSizeControl}
      <Button size="sm" color="secondary" className="button button-secondary" isDisabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))} type="button">{uiText("下一页")}</Button>
    </div>
  </nav>;
}
