/** Test-only ownership: acquire a resource, then immediately register its release. */
export function fixtureResources(){
 const releases:Array<()=>void|Promise<void>>=[];
 let closing:Promise<void>|undefined;
 function close(){return closing??=(async()=>{
  const errors:unknown[]=[];
  while(releases.length){try{await releases.pop()!();}catch(error){errors.push(error);}}
  if(errors.length)throw new AggregateError(errors,'Fixture resource cleanup failed.');
 })();}
 return {
  defer(release:()=>void|Promise<void>){releases.push(release);},
  close,
  async fail(error:unknown):Promise<never>{
   try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Fixture setup and cleanup failed.');}
   throw error;
  },
 };
}
