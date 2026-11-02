import React from 'react';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import ts from 'typescript';
import {patchNativeAccessibility} from './openchatcut-accessibility.mjs';
afterEach(cleanup);
// Pinned 0.2.17 AssetBadges boundary: the SDK owns `used` and its translated label.
const source=`function AssetBadges(props) {const t=value=>value;return <>{props.used && <span className="cc-asset-used-dot" title={t('正在时间线中使用')} aria-label={t('正在时间线中使用')} />}</>;}`;
it('exposes the used-media dot as a named image only while the asset is on the timeline',async()=>{
 const patched=patchNativeAccessibility(source,'/pinned-openchatcut/src/media/MediaPoolCard.tsx')??source;
 const code=ts.transpile(patched,{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020});
 const AssetBadges=new Function('React',code+';return AssetBadges;')(React),view=render(React.createElement(AssetBadges,{used:true}));
 expect(screen.getByRole('img',{name:'正在时间线中使用'}).getAttribute('title')).toBe('正在时间线中使用');
 view.rerender(React.createElement(AssetBadges,{used:false}));expect(screen.queryByRole('img',{name:'正在时间线中使用'})).toBeNull();
});
it('rejects a changed used-media badge anchor rather than silently losing its name',()=>{
 expect(()=>patchNativeAccessibility('function AssetBadges(){return null;}','/pinned-openchatcut/src/media/MediaPoolCard.tsx')).toThrow('无障碍接点');
});
