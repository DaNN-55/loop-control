// Browser-only seam for the single native root mounted by a host plugin.
let surface:{element:HTMLElement;prefix:string}|undefined;
export const isHarnessProduction=()=>surface!==undefined;
export const nativeSurfaceElement=()=>surface?.element??document.documentElement;
export const nativeSurfacePortal=()=>surface?.element??document.body;
export function localNativePath(path:string){return surface&&/^\/(?:api\/local\/|_local-artifact(?:\?|$))/.test(path)?`${surface.prefix}?path=${encodeURIComponent(path)}`:path;}
export function attachNativeSurface(element:HTMLElement,prefix:string){
 if(surface)throw Error('Loop Control already has a mounted native surface.');
 if(!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(prefix))throw Error('Loop Control requires a same-origin native route prefix.');
 const next={element,prefix};surface=next;
 return ()=>{if(surface===next)surface=undefined;};
}
