import {Button} from './dan-ui/components/base/buttons/button';
interface PaginationControlsProps {
  label?: string;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({ label = "分页", page, pageSize, total, onPageChange }: PaginationControlsProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  return <nav aria-label={label} className="pagination-controls">
    <span>第 {page} / {pageCount} 页 · 共 {total} 条</span>
    <div>
      <Button size="sm" color="secondary" className="button button-secondary" isDisabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} type="button">上一页</Button>
      <Button size="sm" color="secondary" className="button button-secondary" isDisabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))} type="button">下一页</Button>
    </div>
  </nav>;
}
