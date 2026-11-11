import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {setUiLocale,uiText,useUiLocale} from './ui';
afterEach(()=>{cleanup();setUiLocale('zh-CN');});
it('updates explicit UI copy while preserving strings outside the translation catalog',()=>{
 function Surface(){useUiLocale();return <><h1>{uiText('个人偏好')}</h1><p>{'用户自己的脚本内容'}</p></>;}
 render(<Surface/>);expect(screen.getByRole('heading').textContent).toBe('个人偏好');
 act(()=>setUiLocale('en-US'));expect(screen.getByRole('heading').textContent).toBe('Preferences');expect(screen.getByText('用户自己的脚本内容')).toBeTruthy();
 act(()=>setUiLocale('zh-CN'));expect(screen.getByRole('heading').textContent).toBe('个人偏好');
});
it('interpolates known values and preserves unknown placeholders and missing source keys',()=>{
 setUiLocale('en-US');expect(uiText('共 {count} 个文件',{count:2})).toBe('2 files');expect(uiText('未知文案 {name} / {missing}',{name:'My project'})).toBe('未知文案 My project / {missing}');
});
