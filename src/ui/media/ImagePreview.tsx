import {uiText} from '../../i18n/ui';
import {useState,type ComponentProps} from 'react';
import {Dialog,Modal,ModalOverlay} from 'react-aria-components';
import {Maximize,X} from 'lucide-react';
import {Button} from '../dan-ui/components/base/buttons/button';
import './media.css';

export function ImageFocusDialog({src,title,imageAlt=title,referrerPolicy,onClose,closeLabel='关闭放大预览'}:{src:string;title:string;imageAlt?:string;referrerPolicy?:ComponentProps<'img'>['referrerPolicy'];onClose:()=>void;closeLabel?:string}){
 return <ModalOverlay className="media-focus-overlay" isOpen isDismissable onOpenChange={open=>{if(!open)onClose();}}>
  <Modal className="media-focus-image">
   <Dialog aria-label={title}>
    <Button className="media-focus-close" type="button" aria-label={closeLabel} autoFocus onPress={onClose}><X size={22}/></Button>
    <img src={src} alt={imageAlt} referrerPolicy={referrerPolicy}/>
   </Dialog>
  </Modal>
 </ModalOverlay>;
}

export function ImagePreview({src,alt='',...props}:ComponentProps<'img'>){
 const [expandedSource,setExpandedSource]=useState<string|null>(null);
 const title=alt||'图片';
 return <>
  <button type="button" className="media-image-trigger" aria-label={uiText("放大{value0}",{value0:String(title)})} disabled={!src} onClick={()=>setExpandedSource(src??null)}>
   <img {...props} src={src} alt={alt}/>
   <span aria-hidden="true"><Maximize size={16}/></span>
  </button>
  {src&&expandedSource===src&&<ImageFocusDialog src={src} title={title} referrerPolicy={props.referrerPolicy} onClose={()=>setExpandedSource(null)}/>}
 </>;
}
