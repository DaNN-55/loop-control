import {defaultOwnerPreferences,type OwnerPreferences} from '../preferences/preferences';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Dialog,DialogTrigger,Popover} from 'react-aria-components';
import {AlertCircle,Bell,ChevronRight,Moon,RefreshCw,Sun} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {WorkspaceSearch} from './WorkspaceSearchPanel';
import {localRequest} from './client';
import type {WorkspaceSearchLocation} from './workspaceSearchTypes';
import type {LocalCatalog} from './catalog';
import './workspace-topbar.css';

export interface WorkspaceTopbarProps {
    theme:'light'|'dark';
    searchScope?:string;
    ownerId?:string;
    notificationPreferences?:OwnerPreferences['notifications'];
    notificationEventsEnabled?:boolean;
    onOpenConnections?:()=>void;
    ownerMenu?:ReactNode;
    onToggleTheme:()=>void;
    themeSaving?:boolean;
    onOpenEpisode:(id:string,search?:WorkspaceSearchLocation)=>void;
    onOpenAccount:(id:string,search?:WorkspaceSearchLocation)=>void;
    onOpenCatalog:(status:'review'|'blocked')=>void;
    onOpenTaskQueue?:()=>void;
    episodeTitles?:ReadonlyMap<string,string>;
    taskQueue?:{blocked:number;failed:number}|null;
}

const attentionPath='catalog?view=operations&visibility=active&page=1&pendingPage=1&blockedPage=1';

/** The single live tool group is shared by the workspace and production detail header. */
export function WorkspaceTopbar({ownerId,ownerMenu,theme,themeSaving,searchScope,onToggleTheme,onOpenEpisode,onOpenAccount,onOpenCatalog,notificationPreferences=defaultOwnerPreferences.notifications,notificationEventsEnabled=false,onOpenConnections,onOpenTaskQueue,episodeTitles,taskQueue}:WorkspaceTopbarProps){
    const [notificationsOpen,setNotificationsOpen]=useState(false);
    const [notificationEvents,setNotificationEvents]=useState<Array<{id:string;event_type:string;episode_id:string|null;episode_title?:string|null;created_at:string;payload:{name?:string;detail?:string}}>>([]);
    const [notificationEventsError,setNotificationEventsError]=useState('');
    const remindersDisabled=notificationPreferences.inApp===false||(!notificationPreferences.review&&!notificationPreferences.failure&&!notificationPreferences.delivery);
    const [attention,setAttention]=useState<LocalCatalog|null>(null);
    const [attentionLoading,setAttentionLoading]=useState(false);
    const [attentionError,setAttentionError]=useState('');
    const [attentionRevision,setAttentionRevision]=useState(0);
    const attentionGeneration=useRef(0);

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

    function openAttentionEpisode(id:string){setNotificationsOpen(false);onOpenEpisode(id);}
    function openAttentionCatalog(status:'review'|'blocked'){setNotificationsOpen(false);onOpenCatalog(status);}

    const attentionItems=new Map<string,{id:string;title:string;review:boolean;blocked:boolean;detail:string}>();
    for(const episode of attention?.pending.items??[])attentionItems.set(episode.id,{id:episode.id,title:episode.title||'未命名生产单',review:true,blocked:false,detail:'审核包已就绪'});
    for(const item of attention?.blocked.items??[]){
        const previous=attentionItems.get(item.episode.id);
        attentionItems.set(item.episode.id,{id:item.episode.id,title:item.episode.title||'未命名生产单',review:previous?.review??false,blocked:true,detail:item.blocker.detail||'存在需要处理的阻塞'});
    }
    const visibleEvents=remindersDisabled?[]:notificationEvents.filter(event=>event.event_type==='publish_package_verified'?notificationPreferences.delivery:notificationPreferences.failure);
    const tasks=taskQueue??attention?.worker;
    const taskIssues=(tasks?.blocked??0)+(tasks?.failed??0);
    const attentionCount=Boolean((attention&&(attention.pending.total>0||attention.blocked.total>0))||taskIssues||visibleEvents.length);

    return <div className="workspace-topbar-tools" role="group" aria-label="工作区工具">
        <WorkspaceSearch key={searchScope} ownerId={ownerId} onOpenEpisode={onOpenEpisode} onOpenAccount={onOpenAccount} onOpen={()=>setNotificationsOpen(false)}/>
        <DialogTrigger isOpen={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <Button size="sm" color="tertiary" className="workspace-topbar-icon workspace-attention-trigger" iconLeading={Bell} aria-label="待处理通知" title="待处理通知">{attentionCount&&<i className="workspace-attention-dot" aria-hidden="true"/>}</Button>
            <Popover placement="bottom end" offset={10} className="dan-ui product-ui workspace-attention-popover">
                <Dialog aria-label="待处理通知" className="workspace-attention-dialog">
                    <header><h2>待处理</h2><Button size="sm" color="tertiary" className="workspace-topbar-icon" iconLeading={RefreshCw} aria-label="刷新待处理" isDisabled={attentionLoading} onPress={()=>setAttentionRevision(value=>value+1)}/></header>
                    {attentionLoading?<p className="workspace-tool-state" role="status">正在读取待处理事项…</p>:attentionError?<div className="workspace-tool-state"><p role="alert">{attentionError}</p><Button size="sm" color="secondary" onPress={()=>setAttentionRevision(value=>value+1)}>重新读取</Button></div>:attention?<>
                        <p className="workspace-attention-summary"><>生产单待审核 {attention.pending.total}</><span>生产单需处理 {attention.blocked.total}</span></p>
                        <ul className="workspace-attention-list">{Array.from(attentionItems.values()).map(item=><li key={item.id}><button type="button" onClick={()=>openAttentionEpisode(item.id)}><span className="workspace-attention-item-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="workspace-attention-flags">{item.review&&<span>待审核</span>}{item.blocked&&<span className="needs-attention">需处理</span>}</span><ChevronRight size={14} aria-hidden="true"/></button></li>)}</ul>
                        {!attentionItems.size&&!taskIssues&&!visibleEvents.length&&<p className="workspace-tool-state">暂无待处理事项。</p>}
                        {taskIssues>0&&onOpenTaskQueue&&<button type="button" className="workspace-attention-failures" onClick={()=>{setNotificationsOpen(false);onOpenTaskQueue();}}><AlertCircle size={15} aria-hidden="true"/><span>后台任务 · {[tasks?.blocked&&`${tasks.blocked} 项阻塞`,tasks?.failed&&`${tasks.failed} 项失败`].filter(Boolean).join(' · ')}</span><ChevronRight size={14} aria-hidden="true"/></button>}
                        {(attention.pending.total>0||attention.blocked.total>0)&&<footer>{attention.pending.total>0&&<button type="button" onClick={()=>openAttentionCatalog('review')}>全部待审核（{attention.pending.total}）</button>}{attention.blocked.total>0&&<button type="button" onClick={()=>openAttentionCatalog('blocked')}>全部需处理（{attention.blocked.total}）</button>}</footer>}
                        {(attention.pending.total>attention.pending.items.length||attention.blocked.total>attention.blocked.items.length)&&<p className="workspace-attention-page-note">当前显示首批事项，可打开全部列表继续查看。</p>}
                    </>:null}
                    {!remindersDisabled&&visibleEvents.length>0&&<section className="workspace-recent-notifications"><h3>最近提醒</h3><ul className="workspace-attention-list">{visibleEvents.map(event=>{
                        const episodeTitle=event.episode_id&&(event.episode_title?.trim()||episodeTitles?.get(event.episode_id)||attention?.episodes?.find(episode=>episode.id===event.episode_id)?.title||`生产单 ${event.episode_id.slice(0,8)}`);
                        const label=event.event_type==='publish_package_verified'?'交付包已完成':event.event_type==='production_task_failed'?'生产任务失败':`${event.payload.name||'连接'}验证失败`;
                        return <li key={event.id}><button type="button" onClick={()=>{setNotificationsOpen(false);if(event.event_type!=='connection_verification_failed'&&event.episode_id)onOpenEpisode(event.episode_id);else onOpenConnections?.();}}><span className="workspace-attention-item-copy"><strong>{episodeTitle||label}</strong><small>{episodeTitle&&`${label} · `}{new Date(event.created_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</small></span><ChevronRight size={14} aria-hidden="true"/></button></li>;})}</ul></section>}
                    {!remindersDisabled&&notificationEventsError&&<p className="workspace-tool-state" role="alert">{notificationEventsError}</p>}
                </Dialog>
            </Popover>
        </DialogTrigger>
        <Button size="sm" color="tertiary" className="workspace-topbar-icon" iconLeading={theme==='light'?Moon:Sun} aria-label={theme==='light'?'切换至深色模式':'切换至浅色模式'} title={theme==='light'?'切换至深色模式':'切换至浅色模式'} aria-pressed={theme==='dark'} isDisabled={themeSaving} onPress={onToggleTheme}/>
        {ownerMenu}

    </div>;
}
