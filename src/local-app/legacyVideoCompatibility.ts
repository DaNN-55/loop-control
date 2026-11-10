/** Frozen blueprints predate unified video selection. This is a read-only default,
 * never a shot classification or a permission to execute a provider. Each new
 * request must still resolve and freeze its own ProductionSelection. */
export function legacyVideoDefault(policy:Record<string,any>|undefined){
 return policy?.a_roll??policy?.b_roll;
}
