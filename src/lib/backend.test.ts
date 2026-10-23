import {describe,it,expect} from 'vitest';
import {selectBackend} from './backend';
describe('business backend selection',()=>{it('uses an explicit local choice and refuses unknown values',()=>{expect(selectBackend('local')).toBe('local');expect(selectBackend('supabase')).toBe('supabase');expect(()=>selectBackend('production-fallback')).toThrow();});});
