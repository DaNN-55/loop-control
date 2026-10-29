// Shared-view contract. Production commands are injected by the local application; missing callbacks fail before network I/O.
import type{Database}from'./database.types.js';
export interface Session{access_token:string;user:{id:string;email?:string};refresh_token?:string;expires_at?:number;expires_in?:number;token_type?:string}
type ErrorValue={message:string;code?:string;details?:string;hint?:string};
type Result<T>={data:T;error:null;count:number|null}|{data:null;error:ErrorValue;count:null};
type AuthResult<T>={data:T;error:ErrorValue|null};
type Tables=Database['public']['Tables'];type Functions=Database['public']['Functions'];
type Item<T>=T extends (infer U)[]?U:T;
type Complete<T>={[K in keyof T]-?:T[K]};
interface SingleQuery<T> extends PromiseLike<Result<T>>{setHeader(name:string,value:string):SingleQuery<T>}
interface Query<T> extends PromiseLike<Result<T[]>>{
 select(columns?:string,options?:{count?:string;head?:boolean}):Query<T>;
 eq(column:string,value:unknown):Query<T>;neq(column:string,value:unknown):Query<T>;in(column:string,values:readonly unknown[]):Query<T>;is(column:string,value:unknown):Query<T>;
 gt(column:string,value:unknown):Query<T>;gte(column:string,value:unknown):Query<T>;lt(column:string,value:unknown):Query<T>;lte(column:string,value:unknown):Query<T>;
 not(column:string,operator:string,value:unknown):Query<T>;or(filters:string):Query<T>;filter(column:string,operator:string,value:unknown):Query<T>;
 order(column:string,options?:{ascending?:boolean;nullsFirst?:boolean;referencedTable?:string}):Query<T>;limit(n:number):Query<T>;range(from:number,to:number):Query<T>;
 single():SingleQuery<T>;maybeSingle():SingleQuery<T|null>;
 insert(value:unknown,options?:unknown):Query<T>;update(value:unknown):Query<T>;upsert(value:unknown,options?:unknown):Query<T>;delete(options?:unknown):Query<T>;
 returns<R>():Promise<Result<R>>;
}
interface RpcQuery<T> extends PromiseLike<Result<T>>{single():SingleQuery<Item<T>>;maybeSingle():SingleQuery<Item<T>|null>;select(columns?:string):Query<Item<T>>;limit(n:number):RpcQuery<T>;range(from:number,to:number):RpcQuery<T>;order(column:string,options?:unknown):RpcQuery<T>;setHeader(name:string,value:string):RpcQuery<T>}
// Unspecialized historical clients had no schema typing. Keep that contract
// confined here; the live local API uses its own checked types and SQL ports.
export interface ViewTransport<Schema=Database>{
 from<K extends (Schema extends Database?keyof Tables:string)>(table:K):Query<Schema extends Database?K extends keyof Tables?Complete<Tables[K]['Row']>:never:any>;
 rpc<K extends (Schema extends Database?keyof Functions:string)>(name:K,args?:Schema extends Database?K extends keyof Functions?Functions[K]['Args']:never:unknown,options?:unknown):RpcQuery<Schema extends Database?K extends keyof Functions?Functions[K]['Returns']:never:any>;
 auth:{getSession():Promise<AuthResult<{session:Session|null}>>;getUser(token?:string):Promise<{data:{user:Session['user']};error:null}|{data:{user:null};error:ErrorValue}>;signInWithPassword(input:{email:string;password:string}):Promise<AuthResult<{session:Session|null;user:Session['user']|null}>>;signOut():Promise<{error:ErrorValue|null}>;updateUser(input:unknown):Promise<AuthResult<{user:Session['user']|null}>>;signInWithOtp(input:unknown):Promise<{error:ErrorValue|null}>;onAuthStateChange(callback:(event:string,session:Session|null)=>void):{data:{subscription:{unsubscribe():void}}}};
}
export const viewTransport=new Proxy(Object.create(null),{get(){throw Error('旧远端访问路径已退役；请使用本地命令。');}})as ViewTransport;
