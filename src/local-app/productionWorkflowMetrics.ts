type Phase='script'|'preparation'|'editing'|'delivery';
interface Fact {episodeId:string;type:string;at:string|Date;payload:Record<string,unknown>}
interface Coverage {from:string|Date;to:string|Date|null}
const phases:Phase[]=['script','preparation','editing','delivery'];
const milestonePhase:Record<string,Phase>={production_created:'script',script_revision_saved:'script',script_confirmed:'preparation',workspace_prepared:'preparation',editing_opened:'editing',native_edit_saved:'editing',export_ready:'delivery',export_confirmed:'delivery'};
const epoch=(value:string|Date)=>value instanceof Date?value.getTime():Date.parse(value);

/** Elapsed intervals require a real milestone and one continuous opt-in period.
 * Database stages, old creation events, UI navigation and coverage observations never fill a gap.
 */
export function summarizeProductionWorkflow(events:Fact[],coverage:Coverage[],from:number,to:number){
 const periods=coverage.map(p=>({from:epoch(p.from),to:p.to===null?Infinity:epoch(p.to)})).sort((a,b)=>a.from-b.from);
 const periodAt=(at:number)=>{let left=0,right=periods.length-1,found=-1;while(left<=right){const middle=(left+right)>>1;if(periods[middle].from<=at){found=middle;left=middle+1;}else right=middle-1;}return found>=0&&at<periods[found].to?found:-1;};
 const seconds:Record<Phase,number|null>={script:null,preparation:null,editing:null,delivery:null},milestones:Record<string,number>={};
 const previous=new Map<string,{phase:Phase;at:number;period:number}>(),episodes=new Set<string>();
 let phaseTransitions=0,backwardTransitions=0,unknownMilestones=0,deliveryCompletions=0;
 const add=(episode:string,state:{phase:Phase;at:number;period:number},until:number)=>{
  const duration=(Math.min(to,until,periods[state.period].to)-Math.max(from,state.at))/1000;
  if(duration>0){seconds[state.phase]=(seconds[state.phase]??0)+duration;episodes.add(episode);}
 };
 for(const event of events.filter(e=>e.type==='workflow_milestone'||e.type==='delivery_completed').sort((a,b)=>epoch(a.at)-epoch(b.at))){
  const at=epoch(event.at);if(!Number.isFinite(at))continue;if(at>=to)break;
  const period=periodAt(at),old=previous.get(event.episodeId),inside=at>=from;
  const name=event.payload.milestone,phase=event.type==='workflow_milestone'&&event.payload.version==='workflow-milestones/v1'&&typeof name==='string'&&Object.hasOwn(milestonePhase,name)&&event.payload.phase===milestonePhase[name]?milestonePhase[name]:null;
  if(inside){if(event.type==='delivery_completed')deliveryCompletions++;else if(phase){milestones[String(name)]=(milestones[String(name)]??0)+1;episodes.add(event.episodeId);}else unknownMilestones++;}
  if(old&&old.phase===phase&&old.period===period)continue;
  if(old){add(event.episodeId,old,at);if(inside&&phase&&old.period===period){phaseTransitions++;if(phases.indexOf(phase)<phases.indexOf(old.phase))backwardTransitions++;}}
  if(phase&&period>=0)previous.set(event.episodeId,{phase,at,period});else previous.delete(event.episodeId);
 }
 for(const [episode,state]of previous)add(episode,state,to);
 const known=Object.values(seconds).filter((n):n is number=>n!==null);
 return{version:'workflow-observation/v1' as const,milestones,phaseSeconds:seconds,knownDurationSeconds:known.length?known.reduce((sum,n)=>sum+n,0):null,
  observedEpisodes:episodes.size,phaseTransitions,backwardTransitions,unknownMilestones,deliveryCompletions,
  includesOwnerWait:true,exclusiveWorkTime:false,automaticReworkClassification:false,coveragePolicy:'observed_intervals_only' as const};
}
