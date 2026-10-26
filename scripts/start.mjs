// Explicit historical deployments remain available for replay; everyday startup has no stage fallback.
const index=process.argv.indexOf('--deployment'),selected=index>=0?process.argv[index+1]:process.env.LOOP_LOCAL_DEPLOYMENT;
if(selected&&!selected.endsWith('/.loop-control/local/deployment.json'))await import('./local/start.mjs');else await import('./runtime/start.mjs');
