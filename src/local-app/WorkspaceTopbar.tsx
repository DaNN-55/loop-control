import {defaultOwnerPreferences,type OwnerPreferences} from '../preferences/preferences';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Dialog,DialogTrigger,Popover} from 'react-aria-components';
import {AlertCircle,Bell,ChevronRight,Clapperboard,FileText,Moon,RefreshCw,Search,Sun,Users,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localArtifactUrl} from '../reviews/localArtifactPreview';
import {localRequest} from './client';
import type {LocalCatalog} from './catalog';
import type {WorkspaceSearchHit,WorkspaceSearchResponse} from './workspaceSearchTypes';
import './workspace-topbar.css';

export interface WorkspaceTopbarProps {
    theme:'light'|'dark';
    notificationPreferences?:OwnerPreferences['notifications'];
    notificationEventsEnabled?:boolean;
    onOpenConnections?:()=>void;
    ownerMenu?:ReactNode;
    onToggleTheme:()=>void;
    onOpenEpisode:(id:string)=>void;
    onOpenAccount:(id:string)=>void;
    onOpenCatalog:(status:'review'|'blocked')=>void;
}

const attentionPath='catalog?view=operations&visibility=active&page=1&pendingPage=1&blockedPage=1';
const groups=[{key:'episodes',label:'生产单',icon:Clapperboard},{key:'accounts',label:'账号',icon:Users},{key:'materials',label:'素材',icon:FileText}] as const;

/** The single live tool group is shared by the workspace and production detail header. */
export function WorkspaceTopbar({ownerMenu,theme,onToggleTheme,onOpenEpisode,onOpenAccount,onOpenCatalog,notificationPreferences=defaultOwnerPreferences.notifications,notificationEventsEnabled=false,onOpenConnections}:WorkspaceTopbarProps){
    const [searchOpen,setSearchOpen]=useState(false);
    const searchContainer=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null);
    const searchResultsId=useId();
    const [notificationsOpen,setNotificationsOpen]=useState(false);
    const [notificationEvents,setNotificationEvents]=useState<Array<{id:string;event_type:string;episode_id:string|null;created_at:string;payload:{name?:string;detail?:string}}>>([]);
    const [notificationEventsError,setNotificationEventsError]=useState('');
    const remindersDisabled=notificationPreferences.inApp===false||(!notificationPreferences.review&&!notificationPreferences.failure&&!notificationPreferences.delivery);
    const [query,setQuery]=useState('');
    const [results,setResults]=useState<WorkspaceSearchResponse|null>(null);
    const [searchLoading,setSearchLoading]=useState(false);
    const [searchError,setSearchError]=useState('');
    const [searchRevision,setSearchRevision]=useState(0);
    const [attention,setAttention]=useState<LocalCatalog|null>(null);
    const [attentionLoading,setAttentionLoading]=useState(false);
    const [attentionError,setAttentionError]=useState('');
    const [attentionRevision,setAttentionRevision]=useState(0);
    const searchGeneration=useRef(0),attentionGeneration=useRef(0);

    useEffect(()=>{
        const shortcut=(event:KeyboardEvent)=>{
            if(event.defaultPrevented||event.isComposing||!(event.metaKey||event.ctrlKey)||event.key.toLowerCase()!=='k')return;
            // Other protected dialogs keep their keyboard context.
            if(!searchOpen&&document.querySelector('[role="dialog"][aria-modal="true"]'))return;
            event.preventDefault();setNotificationsOpen(false);searchInput.current?.focus();setSearchOpen(true);
        };
        document.addEventListener('keydown',shortcut);
        return()=>document.removeEventListener('keydown',shortcut);
    },[searchOpen]);

    useEffect(()=>{
        if(!searchOpen)return;
        const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!searchContainer.current?.contains(event.target))setSearchOpen(false);};
        document.addEventListener('pointerdown',dismiss);
        return()=>document.removeEventListener('pointerdown',dismiss);
    },[searchOpen]);

    useEffect(()=>{
        const generation=++searchGeneration.current,controller=new AbortController();
        const q=query.trim();setSearchError('');setResults(null);
        if(!searchOpen||!q){setSearchLoading(false);return()=>controller.abort();}
        setSearchLoading(true);
        const timer=window.setTimeout(()=>{
            void localRequest('workspace-search?'+new URLSearchParams({q}),{signal:controller.signal})
                .then((value:WorkspaceSearchResponse)=>{if(!controller.signal.aborted&&generation===searchGeneration.current)setResults(value);})
                .catch(error=>{if(!controller.signal.aborted&&generation===searchGeneration.current)setSearchError(error instanceof Error?error.message:'搜索暂不可用。');})
                .finally(()=>{if(!controller.signal.aborted&&generation===searchGeneration.current)setSearchLoading(false);});
        },250);
        return()=>{window.clearTimeout(timer);controller.abort();};
    },[query,searchOpen,searchRevision]);

    useEffect(()=>{
        const generation=++attentionGeneration.current,controller=new AbortController();
        if(!notificationsOpen)return()=>controller.abort();
        setAttentionLoading(true);setAttentionError('');
        void localRequest(attentionPath,{signal:controller.signal})
            .then((value:LocalCatalog)=>{if(!controller.signal.aborted&&generation===attentionGeneration.current)setAttention(value);})
            .catch(error=>{if(!controller.signal.aborted&&generation===attentionGeneration.current)setAttentionError(error instanceof Error?error.message:'待处理信息暂不可用。');})
            .finally(()=>{if(!controller.signal.aborted&&generation===attentionGeneration.current)setAttentionLoading(false);});
        return()=>controller.abort();
    },[notificationsOpen,attentionRevision]);
    useEffect(()=>{const controller=new AbortController();if(!notificationsOpen||!notificationEventsEnabled||remindersDisabled)return;setNotificationEventsError('');void localRequest('notification-events',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){if(!Array.isArray(value))throw Error('最近提醒格式无效。');setNotificationEvents(value);}}).catch(error=>{if(!controller.signal.aborted)setNotificationEventsError(error instanceof Error?error.message:'最近提醒暂不可用。');});return()=>controller.abort();},[notificationsOpen,attentionRevision,notificationEventsEnabled,remindersDisabled]);

    function openHit(hit:WorkspaceSearchHit){
        if(hit.kind==='material'){
            const source=hit.episodeId&&hit.path&&hit.sha256&&/^[a-f0-9]{64}$/.test(hit.sha256)?localArtifactUrl(hit.episodeId,hit.path,hit.sha256):null;
            if(!source){setSearchError('文件引用已变化，请重新搜索。');return;}
            window.open(source,'_blank','noopener,noreferrer');setSearchOpen(false);return;
        }
        setSearchOpen(false);
        if(hit.kind==='episode'&&hit.episodeId)onOpenEpisode(hit.episodeId);
        else if(hit.kind==='account'&&hit.accountId)onOpenAccount(hit.accountId);
    }
    function openAttentionEpisode(id:string){setNotificationsOpen(false);onOpenEpisode(id);}
    function openAttentionCatalog(status:'review'|'blocked'){setNotificationsOpen(false);onOpenCatalog(status);}

    const attentionItems=new Map<string,{id:string;title:string;review:boolean;blocked:boolean;detail:string}>();
    for(const episode of attention?.pending.items??[])attentionItems.set(episode.id,{id:episode.id,title:episode.title||'未命名生产单',review:true,blocked:false,detail:'审核包已就绪'});
    for(const item of attention?.blocked.items??[]){
        const previous=attentionItems.get(item.episode.id);
        attentionItems.set(item.episode.id,{id:item.episode.id,title:item.episode.title||'未命名生产单',review:previous?.review??false,blocked:true,detail:item.blocker.detail||'存在需要处理的阻塞'});
    }
    const hasResults=Boolean(results&&groups.some(group=>results[group.key].length));
    const visibleEvents=remindersDisabled?[]:notificationEvents.filter(event=>event.event_type==='publish_package_verified'?notificationPreferences.delivery:notificationPreferences.failure);
    const attentionCount=Boolean((attention&&(attention.pending.total>0||attention.blocked.total>0||attention.worker.failed>0))||visibleEvents.length);

    return <div className="workspace-topbar-tools" role="group" aria-label="工作区工具">
        <div ref={searchContainer} className="workspace-inline-search" onBlurCapture={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))setSearchOpen(false);}} onKeyDown={event=>{
            if(event.key==='Escape'&&searchOpen){event.preventDefault();event.stopPropagation();searchInput.current?.focus();setSearchOpen(false);}
            if(event.key==='ArrowDown'&&event.target===searchInput.current){const first=searchContainer.current?.querySelector<HTMLButtonElement>('.workspace-search-results button');if(first){event.preventDefault();first.focus();}}
        }}>
            <div className="workspace-global-search"><Search size={15} aria-hidden="true"/><input ref={searchInput} aria-label="查找生产单、账号或素材" aria-controls={searchOpen?searchResultsId:undefined} onClick={()=>setSearchOpen(true)} placeholder="查找生产单、账号或素材" maxLength={200} value={query} onFocus={()=>{setNotificationsOpen(false);setSearchOpen(true);}} onChange={event=>setQuery(event.target.value)}/>{searchOpen?<button type="button" className="workspace-search-close" aria-label="关闭工作区搜索" onClick={()=>{searchInput.current?.focus();setSearchOpen(false);}}><X size={14} aria-hidden="true"/></button>:<kbd aria-hidden="true">⌘ K</kbd>}</div>
            {searchOpen&&<section id={searchResultsId} role="region" aria-label="工作区搜索结果" className="workspace-search-popup">
                {!query.trim()?<p className="workspace-tool-state">输入关键词，查找生产单、账号或素材。</p>:searchLoading?<p className="workspace-tool-state" role="status">正在搜索…</p>:searchError?<div className="workspace-tool-state"><p role="alert">{searchError}</p><Button size="sm" color="secondary" onPress={()=>setSearchRevision(value=>value+1)}>重新搜索</Button></div>:results&&!hasResults?<p className="workspace-tool-state">没有匹配的结果。</p>:results?<div className="workspace-search-results">{groups.map(group=>results[group.key].length?<section key={group.key} aria-label={group.label}><h3>{group.label}</h3><ul>{results[group.key].map(hit=><li key={hit.id}><button type="button" onClick={()=>openHit(hit)}><group.icon size={17} aria-hidden="true"/><span><strong>{hit.title}</strong><small>{hit.subtitle}</small></span><ChevronRight size={14} aria-hidden="true"/></button></li>)}</ul>{results.hasMore[group.key]&&<p className="workspace-search-more">仅显示前 {results[group.key].length} 项，请细化关键词。</p>}</section>:null)}</div>:null}
            </section>}
        </div>
        <DialogTrigger isOpen={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <Button size="sm" color="tertiary" className="workspace-topbar-icon workspace-attention-trigger" iconLeading={Bell} aria-label="待处理通知" title="待处理通知">{attentionCount&&<i className="workspace-attention-dot" aria-hidden="true"/>}</Button>
            <Popover placement="bottom end" offset={10} className="dan-ui product-ui workspace-attention-popover">
                <Dialog aria-label="待处理通知" className="workspace-attention-dialog">
                    <header><h2>待处理</h2><Button size="sm" color="tertiary" className="workspace-topbar-icon" iconLeading={RefreshCw} aria-label="刷新待处理" isDisabled={attentionLoading} onPress={()=>setAttentionRevision(value=>value+1)}/></header>
                    {attentionLoading?<p className="workspace-tool-state" role="status">正在读取待处理事项…</p>:attentionError?<div className="workspace-tool-state"><p role="alert">{attentionError}</p><Button size="sm" color="secondary" onPress={()=>setAttentionRevision(value=>value+1)}>重新读取</Button></div>:attention?<>
                        <p className="workspace-attention-summary"><>待审核 {attention.pending.total}</><span>需处理 {attention.blocked.total}</span></p>
                        <ul className="workspace-attention-list">{Array.from(attentionItems.values()).map(item=><li key={item.id}><button type="button" onClick={()=>openAttentionEpisode(item.id)}><span className="workspace-attention-item-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="workspace-attention-flags">{item.review&&<span>待审核</span>}{item.blocked&&<span className="needs-attention">需处理</span>}</span><ChevronRight size={14} aria-hidden="true"/></button></li>)}</ul>
                        {!attentionItems.size&&attention.worker.failed===0&&!visibleEvents.length&&<p className="workspace-tool-state">暂无待处理事项。</p>}
                        {attention.worker.failed>0&&<button type="button" className="workspace-attention-failures" onClick={()=>openAttentionCatalog('blocked')}><AlertCircle size={15} aria-hidden="true"/><span>{attention.worker.failed} 项任务失败</span><ChevronRight size={14} aria-hidden="true"/></button>}
                        {(attention.pending.total>0||attention.blocked.total>0)&&<footer>{attention.pending.total>0&&<button type="button" onClick={()=>openAttentionCatalog('review')}>全部待审核（{attention.pending.total}）</button>}{attention.blocked.total>0&&<button type="button" onClick={()=>openAttentionCatalog('blocked')}>全部需处理（{attention.blocked.total}）</button>}</footer>}
                        {(attention.pending.total>attention.pending.items.length||attention.blocked.total>attention.blocked.items.length)&&<p className="workspace-attention-page-note">当前显示首批事项，可打开全部列表继续查看。</p>}
                    </>:null}
                    {!remindersDisabled&&visibleEvents.length>0&&<section className="workspace-recent-notifications"><h3>最近提醒</h3><ul className="workspace-attention-list">{visibleEvents.map(event=><li key={event.id}><button type="button" onClick={()=>{setNotificationsOpen(false);if(event.event_type!=='connection_verification_failed'&&event.episode_id)onOpenEpisode(event.episode_id);else onOpenConnections?.();}}><span className="workspace-attention-item-copy"><strong>{event.event_type==='publish_package_verified'?'交付包已完成':event.event_type==='production_task_failed'?'生产任务失败':`${event.payload.name||'连接'}验证失败`}</strong><small>{new Date(event.created_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</small></span><ChevronRight size={14} aria-hidden="true"/></button></li>)}</ul></section>}
                    {!remindersDisabled&&notificationEventsError&&<p className="workspace-tool-state" role="alert">{notificationEventsError}</p>}
                </Dialog>
            </Popover>
        </DialogTrigger>
        <Button size="sm" color="tertiary" className="workspace-topbar-icon" iconLeading={theme==='light'?Moon:Sun} aria-label={theme==='light'?'切换至深色模式':'切换至浅色模式'} title={theme==='light'?'切换至深色模式':'切换至浅色模式'} aria-pressed={theme==='dark'} onPress={onToggleTheme}/>
        {ownerMenu}

    </div>;
}
