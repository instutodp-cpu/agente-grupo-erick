const SOURCE_POLICIES = Object.freeze({
  planalto: { authorityLevel:'primary_official', official:true, allowedForAuthority:true, completeness:'source_scoped' },
  lexml: { authorityLevel:'primary_official', official:true, allowedForAuthority:true, completeness:'source_scoped' },
  cnj_datajud: { authorityLevel:'official_metadata', official:true, allowedForAuthority:false, completeness:'non_guaranteed' },
  stf: { authorityLevel:'primary_official', official:true, allowedForAuthority:true, completeness:'source_scoped' },
  stj: { authorityLevel:'primary_official', official:true, allowedForAuthority:true, completeness:'source_scoped' },
  tst: { authorityLevel:'primary_official', official:true, allowedForAuthority:true, completeness:'source_scoped' },
  anpd: { authorityLevel:'primary_official', official:true, allowedForAuthority:true, completeness:'source_scoped' },
  tribunal_official: { authorityLevel:'primary_official', official:true, allowedForAuthority:true, completeness:'source_scoped' },
  internal: { authorityLevel:'internal', official:false, allowedForAuthority:false, completeness:'organization_scoped' },
  open_web: { authorityLevel:'discovery_only', official:false, allowedForAuthority:false, completeness:'unknown' }
});

function getLegalSourcePolicy(sourceId) {
  return SOURCE_POLICIES[sourceId] || null;
}

function assessSourceUse(sourceId, purpose) {
  const policy = getLegalSourcePolicy(sourceId);
  if (!policy) return {allowed:false, reason:'unregistered_source'};
  if (purpose === 'legal_authority' && !policy.allowedForAuthority) {
    return {allowed:false, reason:'source_not_authoritative_for_purpose'};
  }
  return {allowed:true, reason:'registered_source_policy'};
}

function rankAuthority(sourceId) {
  const p = getLegalSourcePolicy(sourceId);
  if (!p) return 0;
  return {primary_official:4, official_metadata:3, secondary:2, internal:1, discovery_only:0}[p.authorityLevel] ?? 0;
}

module.exports = { SOURCE_POLICIES, getLegalSourcePolicy, assessSourceUse, rankAuthority };
