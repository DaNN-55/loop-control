// Acceptance-only process guard: deny all outbound HTTP and every socket except
// the native test DB. This does not change the host's network or other services.
import {Socket} from 'node:net';
const original=Socket.prototype.connect;
Socket.prototype.connect=function(...args){
 const first=args[0];const options=typeof first==='object'?first:{port:first,host:args[1]};
 if(String(options.port)!=='55472'||options.host!=='127.0.0.1')throw Error('D offline acceptance: outbound socket denied');
 return Reflect.apply(original,this,args);
};
globalThis.fetch=async()=>{throw Error('D offline acceptance: outbound HTTP denied');};
let httpDenied=false,socketDenied=false;
try{await fetch('http://127.0.0.1:55461/auth/v1/user');}catch{httpDenied=true;}
try{new Socket().connect(55461,'127.0.0.1');}catch{socketDenied=true;}
if(!httpDenied||!socketDenied)throw Error('Offline guard self-check failed');
console.log(JSON.stringify({offlineProcessGuard:true,httpDenied,socketDenied,allowedOnly:'127.0.0.1:55472'}));
