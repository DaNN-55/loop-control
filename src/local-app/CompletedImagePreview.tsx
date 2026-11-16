import {useState} from 'react';
import {uiText} from '../i18n/ui';
import {CompletedDialog} from './CompletedDialog';

/** Keep enlarged media in the same native top-layer stack as the shot drawer. */
export function CompletedImagePreview({src,alt}:{src:string;alt:string}){
 const [expanded,setExpanded]=useState(false),[failed,setFailed]=useState(false);
 return <>{failed?<p role="alert">{uiText('图片未能加载，请核对原文件。')}</p>:<button className="completed-image-trigger" type="button" aria-label={uiText('放大{title}',{title:alt})} onClick={()=>setExpanded(true)}><img src={src} alt={alt} onError={()=>setFailed(true)}/></button>}
  <CompletedDialog open={expanded} title={alt} onClose={()=>setExpanded(false)}><img className="completed-enlarged-image" src={src} alt={alt}/></CompletedDialog>
 </>;
}
