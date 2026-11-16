// Operator-invoked read only. Never starts services, migrates, samples, prunes or unlocks Keychain.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const usage='node scripts/production-metrics.mjs --owner <UUID> --from <YYYY-MM-DD> --to-exclusive <YYYY-MM-DD> [--include-test-episodes] [--deployment <JSON path>]';
export function parseProductionMetricsArguments(args){
 const values={},flags=new Set();
 for(let i=0;i<args.length;i++){
  const key=args[i];if(flags.has(key))throw Error('参数重复');flags.add(key);
  if(key==='--include-test-episodes')continue;
  if(!['--owner','--from','--to-exclusive','--deployment'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('参数无效');
  values[key]=args[++i];
 }
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(values['--owner']??''))throw Error('必须显式提供 Owner UUID');
 const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value??''))throw Error('日期无效');const n=Date.parse(value+'T00:00:00+08:00');if(!Number.isFinite(n)||new Date(n+8*3600000).toISOString().slice(0,10)!==value)throw Error('日期无效');return n;};
 const from=date(values['--from']),to=date(values['--to-exclusive']);if(to<=from||to-from>366*86400000)throw Error('统计窗口须为 1 至 366 天，结束日期不包含在内');
 return{ownerId:values['--owner'].toLowerCase(),window:{from:values['--from'],toExclusive:values['--to-exclusive'],includeTestEpisodes:flags.has('--include-test-episodes')},...(values['--deployment']?{deploymentFile:resolve(values['--deployment'])}:{})};
}

async function main(){
 if(process.argv.length===3&&process.argv[2]==='--help'){console.log(usage);return;}
 let options;try{options=parseProductionMetricsArguments(process.argv.slice(2));}catch(error){console.error(error.message+'\n'+usage);process.exitCode=1;return;}
 let pool;
 try{
  const {readSettings}=await import('./runtime/environment.mjs');
  const settings=options.deploymentFile?JSON.parse(await readFile(options.deploymentFile,'utf8')):readSettings();
  const {hydrateDeploymentSecrets}=await import('./runtime/keychain.mjs');
  // Resolve only the app credential; no Worker credential and no recovery/deployment side effects.
  const {database}=hydrateDeploymentSecrets({database:settings.database});
  const {createLocalDatabase}=await import('../dist/local-app/local-app/catalog.js');
  const {readProductionMetricsReport}=await import('../dist/local-app/local-app/productionMetricsReport.js');
  pool=createLocalDatabase(database);
  const configured=settings.productionMetrics?.enabled===true&&typeof settings.productionMetrics.ownerId==='string'&&settings.productionMetrics.ownerId.toLowerCase()===options.ownerId;
  console.log(JSON.stringify(await readProductionMetricsReport(pool,options.ownerId,options.window,configured),null,2));
 }catch(error){
  // Connection/query errors can contain private endpoints or content. Do not echo arbitrary diagnostics.
  const code=typeof error?.code==='string'&&/^(?:[A-Z0-9_]{2,40}|[0-9]{5})$/.test(error.code)?error.code:'report_unavailable';
  console.error('只读汇总未取得（'+code+'）。请检查日期、Owner、数据库访问和 backend:build 输出；本命令不会启用采集或修改数据。');process.exitCode=1;
 }finally{await pool?.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
