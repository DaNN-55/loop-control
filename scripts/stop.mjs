const index=process.argv.indexOf('--deployment'),selected=index>=0?process.argv[index+1]:process.env.LOOP_LOCAL_DEPLOYMENT;
if(selected&&!selected.endsWith('/.loop-control/local/deployment.json'))await import('./local/stop.mjs');else await import('./runtime/stop.mjs');
