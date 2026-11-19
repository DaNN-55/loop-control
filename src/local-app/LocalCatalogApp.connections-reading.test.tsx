import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {LocalCatalogApp} from './LocalCatalogApp';

vi.mock('./LocalSystemStatus',()=>({LocalSystemStatus:()=>null}));
vi.mock('../accounts/AccountWorkspace',()=>({AccountWorkspace:({externalConnections}:{externalConnections:Array<{name:string}>})=><div data-testid="account-connections">{externalConnections.map(connection=>connection.name).join(',')}</div>}));
const account='10000000-0000-4000-8000-000000000001';
const catalog={accounts:[{id:account,name:'Audit account',slug:'audit',timezone:'UTC',current_blueprint_version_id:null}],blueprints:[],blueprintRevisions:{},episodes:[],series:[],seriesVersions:[],promptVersions:[],page:1,total:0,pageSize:20,episodeCount:0,accountCounts:{},reviewCount:0,stages:{},artifactCounts:{},pending:{total:0,items:[]},blocked:{total:0,items:[]},worker:{running:0,blocked:0,failed:0},operationRows:[]};
const choices=(name:string)=>Response.json({connections:[{id:name,name}],versions:[]});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
function defaultResponse(path:string){if(path.endsWith('/session'))return Response.json({owner:{id:'initial-owner'},csrfToken:'fixture'});if(path.includes('/catalog?'))return Response.json(catalog);return Response.json({});}
async function openAccount(){const heading=screen.getByRole('button',{name:'账号'});if(heading.getAttribute('aria-expanded')!=='true')fireEvent.click(heading);fireEvent.click(await screen.findByRole('button',{name:'Audit account'}));}
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();history.replaceState(null,'','/');});

it('starts connections beside the catalog and shows the catalog while connections are still pending',async()=>{
 const listing=deferred<Response>(),connections=deferred<Response>(),reads:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{reads.push(path);if(path.includes('/catalog?'))return listing.promise;if(path.endsWith('/connections'))return connections.promise;return defaultResponse(path);}));
 render(<LocalCatalogApp/>);
 await waitFor(()=>expect(reads.some(path=>path.endsWith('/connections'))).toBe(true));
 await act(async()=>{listing.resolve(Response.json(catalog));});
 expect(await screen.findByRole('complementary',{name:'主导航'})).toBeTruthy();
 await act(async()=>{connections.resolve(choices('Current connection'));});
 await openAccount();
 expect(await screen.findByTestId('account-connections')).toHaveProperty('textContent','Current connection');
});

it('keeps the directory usable when connections fail and retries only connection reading',async()=>{
 let fail=true,catalogReads=0;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.includes('/catalog?'))catalogReads++;if(path.endsWith('/connections'))return fail?Response.json({error:'AUDIT_CONNECTIONS_UNAVAILABLE'},{status:503}):choices('Recovered connection');return defaultResponse(path);}));
 render(<LocalCatalogApp/>);
 expect(await screen.findByRole('complementary',{name:'主导航'})).toBeTruthy();
 expect((await screen.findByRole('alert')).textContent).toContain('AUDIT_CONNECTIONS_UNAVAILABLE');
 const before=catalogReads;fail=false;
 fireEvent.click(screen.getByRole('button',{name:'重新读取连接'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 expect(catalogReads).toBe(before);
 await openAccount();
 expect(await screen.findByTestId('account-connections')).toHaveProperty('textContent','Recovered connection');
});

it('discards late connection reads across Owner expiration and login',async()=>{
 const previous=deferred<Response>();let changed=false;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/login')){changed=true;return Response.json({owner:{id:'next-owner'},csrfToken:'next-fixture'});}if(path.endsWith('/connections'))return changed?choices('Next Owner connection'):previous.promise;return defaultResponse(path);}));
 render(<LocalCatalogApp/>);await screen.findByRole('complementary',{name:'主导航'});
 fireEvent(window,new Event('loop-local-session-expired'));
 await screen.findByRole('heading',{name:'登录控制台'});
 fireEvent.change(screen.getByLabelText('邮箱'),{target:{value:'next@example.invalid'}});
 fireEvent.change(screen.getByLabelText('密码'),{target:{value:'synthetic-password-next'}});
 fireEvent.click(screen.getByRole('button',{name:'使用密码登录'}));
 await screen.findByRole('complementary',{name:'主导航'});
 await act(async()=>{previous.resolve(choices('Previous Owner connection'));});
 await openAccount();
 expect(await screen.findByTestId('account-connections')).toHaveProperty('textContent','Next Owner connection');
});

it('does not let an older connection read overwrite a newer refresh',async()=>{
 const stale=deferred<Response>();let count=0;
 history.replaceState(null,'','/?view=accounts');
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.endsWith('/connections')){count++;if(count===2)return stale.promise;return choices(count===1?'Initial connection':'New connection');}return defaultResponse(path);}));
 render(<LocalCatalogApp/>);
 await waitFor(()=>expect(screen.getByTestId('account-connections').textContent).toBe('Initial connection'));
 fireEvent(document,new Event('visibilitychange'));await waitFor(()=>expect(count).toBe(2));
 fireEvent(document,new Event('visibilitychange'));await waitFor(()=>expect(count).toBe(3));
 await waitFor(()=>expect(screen.getByTestId('account-connections').textContent).toBe('New connection'));
 await act(async()=>{stale.resolve(choices('Stale connection'));});
 expect(screen.getByTestId('account-connections').textContent).toBe('New connection');
});

it('keeps login available when the session expires during its pending directory read',async()=>{
 const listing=deferred<Response>(),connections=deferred<Response>();let connectionStarted=false;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.endsWith('/session'))return Response.json({error:'Sign in required'},{status:401});
  if(path.endsWith('/login'))return Response.json({owner:{id:'login-owner'},csrfToken:'login-fixture'});
  if(path.includes('/catalog?'))return listing.promise;
  if(path.endsWith('/connections')){connectionStarted=true;return connections.promise;}
  return Response.json({});
 }));
 render(<LocalCatalogApp/>);await screen.findByRole('heading',{name:'登录控制台'});
 fireEvent.change(screen.getByLabelText('邮箱'),{target:{value:'login@example.invalid'}});
 fireEvent.change(screen.getByLabelText('密码'),{target:{value:'synthetic-password-login'}});
 fireEvent.click(screen.getByRole('button',{name:'使用密码登录'}));
 await waitFor(()=>expect(connectionStarted).toBe(true));
 await act(async()=>{connections.resolve(Response.json({error:'Session expired'},{status:401}));});
 await screen.findByRole('heading',{name:'登录控制台'});
 await act(async()=>{listing.resolve(Response.json(catalog));});
 expect(screen.getByRole('heading',{name:'登录控制台'})).toBeTruthy();
 expect((screen.getByRole('button',{name:'使用密码登录'})as HTMLButtonElement).disabled).toBe(false);
 expect(screen.queryByRole('status')).toBeNull();
});
