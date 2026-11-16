// @vitest-environment node
import {expect,it} from 'vitest';
import {parseProductionMetricsArguments} from './production-metrics.mjs';
const owner='11111111-1111-4111-8111-111111111111';
it('requires an explicit Owner and bounded date window, with test episodes excluded by default',()=>{
 expect(parseProductionMetricsArguments(['--owner',owner,'--from','2026-11-01','--to-exclusive','2026-11-17'])).toEqual({ownerId:owner,window:{from:'2026-11-01',toExclusive:'2026-11-17',includeTestEpisodes:false}});
});
it.each([
 [],['--owner',owner],['--owner',owner,'--from','2026-02-30','--to-exclusive','2026-03-02'],
 ['--owner',owner,'--from','2026-11-01','--to-exclusive','2026-11-17','--enable'],
 ['--owner',owner,'--owner',owner,'--from','2026-11-01','--to-exclusive','2026-11-17'],
 ['--owner',owner,'--from','2025-01-01','--to-exclusive','2026-11-17'],
])('rejects missing, invalid, duplicate or mutation arguments: %j',args=>{expect(()=>parseProductionMetricsArguments(args)).toThrow();});
