import { X } from 'lucide-react';
import { Button } from '../ui/dan-ui/components/base/buttons/button';

interface AppliedFilter {
  label: string;
  value: string | undefined;
  clear: () => void;
}

export function AppliedFilters({ filters, onReset, restoreFocus }: {
  filters: AppliedFilter[];
  onReset: () => void;
  restoreFocus: () => void;
}) {
  if (filters.length === 0) return null;
  return <div className="episode-applied-filters" role="group" aria-label="已应用筛选">
    <span>已应用筛选</span>
    {filters.map(({ label, value, clear }) => <button key={label} className="episode-filter-chip" type="button" aria-label={`清除${label}筛选：${value}`} title={`${label} · ${value}`} onClick={() => { restoreFocus(); clear(); }}>
      <span>{label} · {value}</span><X size={13} aria-hidden="true" />
    </button>)}
    <Button size="sm" color="tertiary" onPress={() => { restoreFocus(); onReset(); }}>清空筛选</Button>
  </div>;
}
