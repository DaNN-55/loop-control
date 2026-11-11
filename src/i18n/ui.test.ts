import {afterEach,expect,it} from 'vitest';
import {getUiLocale,setUiLocale,uiText} from './ui';
afterEach(()=>setUiLocale('zh-CN'));
it('changes only explicit product copy and preserves interpolation values',()=>{setUiLocale('en-US');expect(getUiLocale()).toBe('en-US');expect(uiText('生产单')).toBe('Production order');expect(uiText('打开生产单 {value0}',{value0:'生产单'})).toBe('Open production order 生产单');expect(uiText('用户写的原始正文与API模型编号')).toBe('用户写的原始正文与API模型编号');setUiLocale('zh-CN');expect(uiText('生产单')).toBe('生产单');});
it('renders stored product feedback in either language without altering values',()=>{const source='已导入 3 项，1 项失败';setUiLocale('en-US');expect(uiText(source)).toBe('Imported 3 items; 1 failed');expect(uiText('镜头时长保持 4.50 秒')).toBe('Shot duration stays at 4.50 seconds');expect(uiText('原始供应商错误：未经证实')).toBe('原始供应商错误：未经证实');setUiLocale('zh-CN');expect(uiText(source)).toBe(source);});
