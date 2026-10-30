/** Vector redraw of the Owner-provided open-ring brand mark. */
export function LoopControlMark({size=28}:{size?:number}){
 return <svg className="lc-brand-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false"><path d="M24.49 24.49A12 12 0 1 0 19.11 27.59" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round"/><path d="M22.34 26.19A12 12 0 0 0 24.49 24.49" stroke="currentColor" strokeOpacity=".65" strokeWidth="4.2" strokeLinecap="round"/></svg>;
}
