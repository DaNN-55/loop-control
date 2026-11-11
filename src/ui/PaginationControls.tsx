import {uiText} from '../i18n/ui';
import {Button} from './dan-ui/components/base/buttons/button';
import type {ReactNode} from 'react';
interface PaginationControlsProps {
  label?: string;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeControl?: ReactNode;
}

export function PaginationControls({ label = "分页", page, pageSize, total, onPageChange, pageSizeControl }: PaginationControlsProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
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
