function dateOnly(value){if(!value)return null;const d=new Date(value+'T00:00:00Z');return Number.isNaN(d.getTime())?null:d;}
function assessAuthorityAt(authority, asOf){
  if(!authority || !asOf) return {applicable:false,reason:'missing_temporal_context'};
  const at=dateOnly(asOf), published=dateOnly(authority.publication_date), from=dateOnly(authority.effective_from), until=dateOnly(authority.effective_until);
  if(!at || !published) return {applicable:false,reason:'invalid_date'};
  if(at < published) return {applicable:false,reason:'not_published_at_date'};
  if(from && at < from) return {applicable:false,reason:'not_yet_effective'};
  if(until && at > until) return {applicable:false,reason:'no_longer_effective'};
  if(['revoked','expired'].includes(authority.status) && !until) return {applicable:false,reason:'terminal_status_without_temporal_boundary'};
  if(authority.status==='suspended') return {applicable:false,reason:'authority_suspended'};
  if(authority.status==='unknown') return {applicable:false,reason:'authority_status_unknown'};
  return {applicable:true,reason:'temporally_applicable'};
}
function detectAuthorityConflict(authorities, asOf){
  const applicable=authorities.filter(a=>assessAuthorityAt(a,asOf).applicable);
  const ids=new Set(applicable.map(a=>a.authority_id));
  const conflicts=[];
  for(const a of applicable){
    for(const target of a.supersedes||[]) if(ids.has(target)) conflicts.push({type:'supersession_overlap',authority_id:a.authority_id,target_id:target});
    for(const target of a.superseded_by||[]) if(ids.has(target)) conflicts.push({type:'supersession_overlap',authority_id:a.authority_id,target_id:target});
  }
  return {applicable:applicable.map(a=>a.authority_id),conflicts};
}
module.exports={assessAuthorityAt,detectAuthorityConflict};
