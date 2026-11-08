import {ChevronDown, Plus, Search, Users} from 'lucide-react';
import {useEffect, useId, useState} from 'react';
import type {Database} from '../lib/database.types';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';

type Account = Database['public']['Tables']['accounts']['Row'];
const previewSize = 5;
const compactRail = () => window.matchMedia?.('(max-width: 900px)').matches ?? false;

export function AccountSidebar({accounts, activeId, collapsed, onExpandSidebar, onSelect, onCreate}: {
  accounts: Account[];
  activeId: string | null;
  collapsed: boolean;
  onExpandSidebar: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(() => Boolean(activeId) && !compactRail());
  const [showAll, setShowAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const active = accounts.filter(account => !account.archived_at);
  const archived = accounts.filter(account => account.archived_at);
  const activeIndex = active.findIndex(account => account.id === activeId);
  const archivedSelected = archived.some(account => account.id === activeId);

  useEffect(() => {
    if (activeId && !compactRail()) setOpen(true);
    if (activeIndex >= previewSize) setShowAll(true);
    if (archivedSelected) setShowArchived(true);
  }, [activeId, activeIndex, archivedSelected]);

  const search = query.trim().toLocaleLowerCase();
  const visible = showAll ? active.filter(account => account.name.toLocaleLowerCase().includes(search)) : active.slice(0, previewSize);
  function rows(items: Account[]) {
    return items.map(account => <li key={account.id}>
      <Button size="sm" color="tertiary" type="button" className="sidebar-account-entry" title={account.name}
        aria-current={account.id === activeId ? 'page' : undefined} onClick={() => onSelect(account.id)}>
        <span className="sidebar-account-initial" aria-hidden="true">{Array.from(account.name.trim())[0] ?? '账'}</span>
        <span className="sidebar-account-name">{account.name}</span>
      </Button>
    </li>);
  }

  return <div role="group" aria-label="账号管理" className="navigation-group sidebar-account-group">
    <div className="sidebar-account-heading">
      <Button size="sm" color="tertiary" type="button" aria-label="账号" aria-expanded={open && !collapsed} aria-controls={id}
        className={`navigation-item${activeId ? ' is-active' : ''}`} iconLeading={Users}
        onClick={() => {
          if (collapsed) { onExpandSidebar(); setOpen(true); }
          else setOpen(!open);
        }}>
        <span className="navigation-label">账号</span>
        <ChevronDown className="sidebar-account-chevron" size={14} aria-hidden="true" />
      </Button>
      <Button size="sm" color="tertiary" type="button" aria-label="新建账号" title="新建账号"
        className="sidebar-account-add" iconLeading={Plus} onClick={onCreate} />
    </div>
    <div id={id} className="sidebar-account-list" hidden={!open || collapsed}>
      {showAll && active.length > 8 && <InputBase size="sm" icon={Search} type="search" aria-label="查找账号"
        placeholder="查找账号" value={query} onChange={event => setQuery(event.target.value)} />}
      <ul aria-label="使用中的账号">{rows(visible)}</ul>
      {!visible.length && <p>{search ? '没有匹配的账号' : '暂无使用中的账号'}</p>}
      {active.length > previewSize && <Button size="sm" color="tertiary" type="button" className="sidebar-account-entry sidebar-account-more"
        aria-expanded={showAll} onClick={() => { setShowAll(!showAll); setQuery(''); }}>
        {showAll ? '收起账号列表' : `查看全部 ${active.length} 个账号`}
      </Button>}
      {!!archived.length && <>
        <Button size="sm" color="tertiary" type="button" className="sidebar-account-entry sidebar-account-more"
          aria-expanded={showArchived} aria-controls={`${id}-archived`} iconTrailing={ChevronDown} onClick={() => setShowArchived(!showArchived)}>
          已归档 · {archived.length}
        </Button>
        <ul aria-label="已归档的账号" id={`${id}-archived`} hidden={!showArchived}>{rows(archived)}</ul>
      </>}
    </div>
  </div>;
}
