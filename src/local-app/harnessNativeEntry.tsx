import {createRoot} from 'react-dom/client';
import {enableShadowDOM} from 'react-stately/private/flags/flags';
import {UNSAFE_PortalProvider} from 'react-aria';
import {LocalCatalogApp} from './LocalCatalogApp';
import {attachNativeSurface} from './nativeSurface';
import '../styles.css';
import '../ui/impeccable/foundation.css';
import '../ui/impeccable/configuration.css';
import '../ui/impeccable/maintenance.css';
import '../ui/impeccable/production.css';
import '../ui/impeccable/scroll-layout.css';
import '../ui/impeccable/surface-polish.css';
import '../ui/impeccable/detail-refinement.css';
import '../ui/impeccable/interaction-refinement.css';
import './harness-native.css';

export interface NativeMountOptions {stylesheetUrl:string;apiPrefix?:string}

/** Mount once; the Harness slot adapter can move the host without recreating the workbench. */
export function mountLoopControl(host:HTMLElement,{stylesheetUrl,apiPrefix='/api/team-loop-control/native'}:NativeMountOptions):()=>void{
 // React Aria's installed shadow-root event/focus support is opt-in.
 enableShadowDOM();
 const url=new URL(stylesheetUrl,document.baseURI);
 if(url.origin!==location.origin||url.username||url.password)throw Error('Loop Control requires a same-origin stylesheet.');
 const shadow=host.shadowRoot??host.attachShadow({mode:'open',delegatesFocus:true});
 const surface=document.createElement('div'),canvas=document.createElement('div'),stylesheet=document.createElement('link');
 surface.className='loop-native-scope';surface.dataset.interface='impeccable';canvas.className='loop-native-canvas';
 stylesheet.rel='stylesheet';stylesheet.href=url.href;
 const release=attachNativeSurface(surface,apiPrefix);
 shadow.append(stylesheet,surface);surface.append(canvas);
 const root=createRoot(canvas);
 root.render(<UNSAFE_PortalProvider getContainer={()=>surface}><LocalCatalogApp/></UNSAFE_PortalProvider>);
 let mounted=true;
 return ()=>{if(!mounted)return;mounted=false;try{root.unmount();}finally{release();surface.remove();stylesheet.remove();}};
}
