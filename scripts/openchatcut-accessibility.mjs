import {readFileSync} from 'node:fs';
import {join} from 'node:path';
/** Host-owned adaptations for the pinned OpenChatCut 0.2.17 source.
 * Exact anchors intentionally reject SDK drift rather than silently losing semantics.
 */
function replaceSource(code, anchor, replacement) {
  if (!code.includes(anchor)) throw Error('当前 Studio 缺少已验证的无障碍接点。');
  return code.replace(anchor, replacement);
}

export function patchNativeAccessibility(code, id) {
  const path = id.split('?')[0];
  if (path.endsWith('/src/components/settings/SkinPicker.tsx')) {
    code = "import {useNativeMenuFocus} from 'virtual:loop-control-accessibility';\n" + code;
    code = replaceSource(code, "  const [current, setCurrent] = useState(getSkin);", "  const menu = useNativeMenuFocus(open, setOpen);\n  const [current, setCurrent] = useState(getSkin);");
    code = replaceSource(code, "<div style={{ position: 'relative', display: 'inline-flex' }}>", "<div onKeyDown={menu.onKeyDown} style={{ position: 'relative', display: 'inline-flex' }}>");
    code = replaceSource(code, '<button type="button" data-tip={t(\'皮肤\')}', '<button ref={menu.triggerRef} aria-controls={open ? menu.id : undefined} type="button" data-tip={t(\'皮肤\')}');
    code = replaceSource(code, '<div role="menu" aria-label={t(\'皮肤\')}', '<div ref={menu.menuRef} id={menu.id} role="menu" aria-label={t(\'皮肤\')}');
    code = replaceSource(code, 'role="menuitemradio" aria-checked={active}', 'role="menuitemradio" tabIndex={-1} aria-checked={active}');
    return code;
  }
  if (path.endsWith('/src/components/Divider.tsx')) {
    code = "import {useNativeDividerValue} from 'virtual:loop-control-accessibility';\n" + code;
    code = replaceSource(code, "orientation = 'vertical' }: { onResize:", "orientation = 'vertical', label }: { label: string; onResize:");
    code = replaceSource(code, "  const horiz = orientation === 'horizontal';", "  const horiz = orientation === 'horizontal';\n  const {ref, value} = useNativeDividerValue(horiz);");
    code = replaceSource(code, '      role="separator"', '      ref={ref}\n      role="separator"\n      aria-valuemin={0}\n      aria-valuemax={100}\n      aria-valuenow={value}\n      aria-valuetext={`${value}%`}');
    code = replaceSource(code, "aria-label={t('拖动调整大小')}", 'aria-label={label}');
    return replaceSource(code, '        event.preventDefault();', '        event.preventDefault();\n        event.stopPropagation();');
  }
  if (path.endsWith('/src/editor/EditorWorkspaceView.tsx')) {
    code = replaceSource(code, '<Divider onResize={props.onResizeChat}', '<Divider label="聊天与素材分隔位置" onResize={props.onResizeChat}');
    code = replaceSource(code, '<Divider onResize={props.onResizeLibrary}', '<Divider label="素材与预览分隔位置" onResize={props.onResizeLibrary}');
    return replaceSource(code, '<Divider orientation="horizontal"', '<Divider label="预览与时间线分隔位置" orientation="horizontal"');
  }
  if (path.endsWith('/src/components/timeline/TimelineToolbar.tsx')) {
    code = replaceSource(code, '<input type="range" min={MIN_TIME_ZOOM}', '<label style={{display: \'inline-flex\', alignItems: \'center\', gap: 4}}><span>{t(\'缩放\')}</span><input type="range" min={MIN_TIME_ZOOM}');
    return replaceSource(code, "title={t('缩放时间轴')} className=\"cc-timeline-zoom\" />", "aria-label={t('缩放时间轴')} title={t('缩放时间轴')} className=\"cc-timeline-zoom\" /></label>");
  }
  if (path.endsWith('/src/library/SoundBrowser.tsx')) {
    code = replaceSource(code, 'role="listbox"', 'role="list"');
    code = replaceSource(code, 'role="option"\n      aria-selected={playing}', 'role="listitem"\n      aria-label={displayName}');
    return replaceSource(code, 'className="cc-sound-glyph"', 'className="cc-sound-glyph"\n        aria-pressed={playing}');
  }
  if (path.endsWith('/src/editor/TimelineMediaLayer.tsx') || path.endsWith('/src/gl/ClipFx.tsx') || path.endsWith('/src/gl/GlTransition.tsx')) {
    // These are content frames, so expose the source item's name. Library thumbnails
    // with their own captions already have deliberate alt semantics and stay intact.
    if (!code.includes('<Img ') || !code.includes('src={item.src!}')) throw Error('当前 Studio 缺少已验证的预览图像接点。');
    return code.replace(/<Img /g, '<Img alt={item.name ?? \'画面预览\'} ');
  }
}

/** Hooks loaded into the SDK by Vite; never import the host application's React. */
export const nativeAccessibilityRuntime = `
import {useEffect,useLayoutEffect,useRef,useState,useId} from 'react';
export function useNativeMenuFocus(open,setOpen){
 const triggerRef=useRef(null),menuRef=useRef(null),openAtEnd=useRef(false),id=useId();
 useEffect(()=>{if(open){const items=menuRef.current?.querySelectorAll('[role=menuitemradio]');items?.[openAtEnd.current?items.length-1:0]?.focus();openAtEnd.current=false;}},[open]);
 function onKeyDown(event){
  const key=event.key;
  if(!open){if(key==='ArrowDown'||key==='ArrowUp'){event.preventDefault();event.stopPropagation();openAtEnd.current=key==='ArrowUp';setOpen(true);}return;}
  if(key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);triggerRef.current?.focus();return;}
  if(key==='Tab'){event.stopPropagation();setOpen(false);triggerRef.current?.focus();return;}
  if(key==='Enter'||key===' '){event.stopPropagation();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(key))return;
  event.preventDefault();event.stopPropagation();
  const items=[...menuRef.current.querySelectorAll('[role=menuitemradio]:not(:disabled)')];
  const index=items.indexOf(event.target),last=items.length-1;
  const next=key==='Home'?0:key==='End'?last:key==='ArrowDown'?(index+1)%items.length:(index+items.length-1)%items.length;
  items[next]?.focus();
 }
 return{triggerRef,menuRef,id,onKeyDown};
}
export function useNativeDividerValue(horizontal){
 const ref=useRef(null),[value,setValue]=useState(0);
 useLayoutEffect(()=>{
  const node=ref.current,shell=node?.closest('.cc-editor-shell');if(!shell)return;
  const update=()=>{const r=node.getBoundingClientRect(),s=shell.getBoundingClientRect();const position=horizontal?r.top-s.top:r.left-s.left,size=horizontal?s.height:s.width;setValue(size?Math.round(Math.max(0,Math.min(100,position/size*100))*10)/10:0);};
  update();const observer=new ResizeObserver(update);observer.observe(shell);for(const panel of shell.children)observer.observe(panel);return()=>observer.disconnect();
 },[horizontal]);
 return{ref,value};
}
`;

export function nativeAccessibilityPlugin(root) {
  if (JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version !== '0.2.17') throw Error('Studio 无障碍适配仅验证了 OpenChatCut 0.2.17，请先核对新版接点。');
  const virtual='\0loop-control-accessibility';
  return {name:'loop-control-native-accessibility',enforce:'pre',
    resolveId(id){if(id==='virtual:loop-control-accessibility')return virtual;},
    load(id){if(id===virtual)return nativeAccessibilityRuntime;},
    transform(code,id){const patched=patchNativeAccessibility(code,id);if(patched!==undefined)return{code:patched,map:null};},
  };
}
