import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Dialog,DialogTrigger,Modal,ModalOverlay,Popover} from 'react-aria-components';
import {AlertCircle,Bell,ChevronRight,Clapperboard,FileText,Moon,RefreshCw,Search,Sun,Users,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {localArtifactUrl} from '../reviews/localArtifactPreview';
import {localRequest} from './client';
import type {LocalCatalog} from './catalog';
import type {WorkspaceSearchHit,WorkspaceSearchResponse} from './workspaceSearchTypes';
import './workspace-topbar.css';

export interface WorkspaceTopbarProps {
    theme:'light'|'dark';
    ownerMenu?:ReactNode;
    onToggleTheme:()=>void;
    onOpenEpisode:(id:string)=>void;
    onOpenAccount:(id:string)=>void;
    onOpenCatalog:(status:'review'|'blocked')=>void;
}

const attentionPath='catalog?view=operations&visibility=active&page=1&pendingPage=1&blockedPage=1';
const groups=[{key:'episodes',label:'生产单',icon:Clapperboard},{key:'accounts',label:'账号',icon:Users},{key:'materials',label:'素材',icon:FileText}] as const;

/** The single live tool group is shared by the workspace and production detail header. */
export function WorkspaceTopbar({ownerMenu,theme,onToggleTheme,onOpenEpisode,onOpenAccount,onOpenCatalog}:WorkspaceTopbarProps){
    const [searchOpen,setSearchOpen]=useState(false);
    const [notificationsOpen,setNotificationsOpen]=useState(false);
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
            event.preventDefault();setNotificationsOpen(false);setSearchOpen(true);
        };
        document.addEventListener('keydown',shortcut);
        return()=>document.removeEventListener('keydown',shortcut);
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
    const attentionCount=attention?(attention.pending.total>0||attention.blocked.total>0||attention.worker.failed>0):false;

    return <div className="workspace-topbar-tools" role="group" aria-label="工作区工具">
        <Button size="sm" color="secondary" className="workspace-global-search" iconLeading={Search} aria-label="搜索工作区" onPress={()=>{setNotificationsOpen(false);setSearchOpen(true);}}><span>查找生产单、账号或素材</span><kbd aria-hidden="true">⌘ K</kbd></Button>
        <DialogTrigger isOpen={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <Button size="sm" color="tertiary" className="workspace-topbar-icon workspace-attention-trigger" iconLeading={Bell} aria-label="待处理通知" title="待处理通知">{attentionCount&&<i className="workspace-attention-dot" aria-hidden="true"/>}</Button>
            <Popover placement="bottom end" offset={10} className="dan-ui product-ui workspace-attention-popover">
                <Dialog aria-label="待处理通知" className="workspace-attention-dialog">
                    <header><h2>待处理</h2><Button size="sm" color="tertiary" className="workspace-topbar-icon" iconLeading={RefreshCw} aria-label="刷新待处理" isDisabled={attentionLoading} onPress={()=>setAttentionRevision(value=>value+1)}/></header>
                    {attentionLoading?<p className="workspace-tool-state" role="status">正在读取待处理事项…</p>:attentionError?<div className="workspace-tool-state"><p role="alert">{attentionError}</p><Button size="sm" color="secondary" onPress={()=>setAttentionRevision(value=>value+1)}>重新读取</Button></div>:attention?<>
                        <p className="workspace-attention-summary">待审核 {attention.pending.total}<span>需处理 {attention.blocked.total}</span></p>
                        <ul className="workspace-attention-list">{Array.from(attentionItems.values()).map(item=><li key={item.id}><button type="button" onClick={()=>openAttentionEpisode(item.id)}><span className="workspace-attention-item-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="workspace-attention-flags">{item.review&&<span>待审核</span>}{item.blocked&&<span className="needs-attention">需处理</span>}</span><ChevronRight size={14} aria-hidden="true"/></button></li>)}</ul>
                        {!attentionItems.size&&attention.worker.failed===0&&<p className="workspace-tool-state">暂无待处理事项。</p>}
                        {attention.worker.failed>0&&<button type="button" className="workspace-attention-failures" onClick={()=>openAttentionCatalog('blocked')}><AlertCircle size={15} aria-hidden="true"/><span>{attention.worker.failed} 项任务失败</span><ChevronRight size={14} aria-hidden="true"/></button>}
                        {(attention.pending.total>0||attention.blocked.total>0)&&<footer>{attention.pending.total>0&&<button type="button" onClick={()=>openAttentionCatalog('review')}>全部待审核（{attention.pending.total}）</button>}{attention.blocked.total>0&&<button type="button" onClick={()=>openAttentionCatalog('blocked')}>全部需处理（{attention.blocked.total}）</button>}</footer>}
                        {(attention.pending.total>attention.pending.items.length||attention.blocked.total>attention.blocked.items.length)&&<p className="workspace-attention-page-note">当前显示首批事项，可打开全部列表继续查看。</p>}
                    </>:null}
                </Dialog>
            </Popover>
        </DialogTrigger>
        <Button size="sm" color="tertiary" className="workspace-topbar-icon" iconLeading={theme==='light'?Moon:Sun} aria-label={theme==='light'?'切换至深色模式':'切换至浅色模式'} title={theme==='light'?'切换至深色模式':'切换至浅色模式'} aria-pressed={theme==='dark'} onPress={onToggleTheme}/>
        {ownerMenu}
        <ModalOverlay isOpen={searchOpen} isDismissable onOpenChange={setSearchOpen} className="dan-ui product-ui workspace-search-overlay">
            <Modal className="workspace-search-modal"><Dialog aria-label="搜索工作区" className="workspace-search-dialog">
                <header><InputBase size="sm" icon={Search} autoFocus aria-label="查找生产单、账号或素材" placeholder="搜索标题、账号或文件名" maxLength={200} value={query} onChange={event=>setQuery(event.target.value)}/><Button size="sm" color="tertiary" className="workspace-topbar-icon" iconLeading={X} aria-label="关闭工作区搜索" onPress={()=>setSearchOpen(false)}/></header>
                {!query.trim()?<p className="workspace-tool-state">输入关键词，查找生产单、账号或素材。</p>:searchLoading?<p className="workspace-tool-state" role="status">正在搜索…</p>:searchError?<div className="workspace-tool-state"><p role="alert">{searchError}</p><Button size="sm" color="secondary" onPress={()=>setSearchRevision(value=>value+1)}>重新搜索</Button></div>:results&&!hasResults?<p className="workspace-tool-state">没有匹配的结果。</p>:results?<div className="workspace-search-results">{groups.map(group=>results[group.key].length?<section key={group.key} aria-label={group.label}><h3>{group.label}</h3><ul>{results[group.key].map(hit=><li key={hit.id}><button type="button" onClick={()=>openHit(hit)}><group.icon size={17} aria-hidden="true"/><span><strong>{hit.title}</strong><small>{hit.subtitle}</small></span><ChevronRight size={14} aria-hidden="true"/></button></li>)}</ul>{results.hasMore[group.key]&&<p className="workspace-search-more">仅显示前 {results[group.key].length} 项，请细化关键词。</p>}</section>:null)}</div>:null}
            </Dialog></Modal>
        </ModalOverlay>
    </div>;
}
