import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';

export function WorkspaceNoticeToast({message,noticeKey}:{message:string;noticeKey:string}){
 const [visible,setVisible]=useState(true);
 useEffect(()=>{setVisible(true);const timer=setTimeout(()=>setVisible(false),5000);return()=>clearTimeout(timer);},[message,noticeKey]);
 return visible?createPortal(<div className="workspace-notice-toast" role="status"><span>{message}</span><button type="button" aria-label="关闭提示" onClick={()=>setVisible(false)}><X size={16} aria-hidden="true"/></button></div>,document.body):null;
}
