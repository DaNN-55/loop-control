// @vitest-environment node
import {it,expect} from 'vitest';
import {hashPassword,verifyPassword} from './password';
it('uses distinct salted password digests and rejects wrong passwords',async()=>{
 const a=await hashPassword('synthetic long password'),b=await hashPassword('synthetic long password');
 expect(a).not.toEqual(b);expect(await verifyPassword('synthetic long password',a)).toBe(true);expect(await verifyPassword('wrong',a)).toBe(false);
});
