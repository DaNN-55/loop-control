import {Socket} from 'node:net';
import {appendFileSync} from 'node:fs';
const original=Socket.prototype.connect;
Socket.prototype.connect=function(...args){const first=args[0],o=typeof first==='object'?first:{port:first,host:args[1]};if(String(o.port)!=='55472'||o.host!=='127.0.0.1'){appendFileSync("/Users/dan/.codex/worktrees/local-first-optimization/loop-control/.loop-control/stage-d/state/t17-20261024/network-blocks.jsonl",JSON.stringify({pid:process.pid,blocked:true,kind:'socket'})+'\n',{mode:0o600});throw Error('T17 offline socket denied');}return Reflect.apply(original,this,args);};
globalThis.fetch=async()=>{appendFileSync("/Users/dan/.codex/worktrees/local-first-optimization/loop-control/.loop-control/stage-d/state/t17-20261024/network-blocks.jsonl",JSON.stringify({pid:process.pid,blocked:true,kind:'fetch'})+'\n',{mode:0o600});throw Error('T17 offline HTTP denied');};
