interface PaginationControlsProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({ page, pageSize, total, onPageChange }: PaginationControlsProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  return <nav aria-label="分页" className="pagination-controls">
    <span>第 {page} / {pageCount} 页 · 共 {total} 条</span>
    <div>
      <button className="button button-secondary" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} type="button">上一页</button>
      <button className="button button-secondary" disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))} type="button">下一页</button>
    </div>
  </nav>;
}
