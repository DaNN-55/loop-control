import {HistorySources} from './HistorySources';

export function LocalHistory() {
  return (
    <section aria-label="历史资料" className="dan-ui history-ui history-workspace reference-history">
      <div className="reference-history-surface">
        <HistorySources />
      </div>
    </section>
  );
}
