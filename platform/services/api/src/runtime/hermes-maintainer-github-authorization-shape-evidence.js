'use strict';

const EVIDENCE_VERSION='hermes_maintainer_github_authorization_shape_evidence_v1';

function collectHermesMaintainerGithubAuthorizationShapeEvidence(resolution){
 const authorization=resolution?.ok===true&&typeof resolution.authorization==='string'?resolution.authorization:'';
 const bearerPrefix=authorization.startsWith('Bearer ');
 const material=bearerPrefix?authorization.slice(7):'';
 return Object.freeze({
  evidence_version:EVIDENCE_VERSION,
  credential_reference:'github_read_only_staging',
  resolution_ok:resolution?.ok===true,
  authorization_present:authorization.length>0,
  bearer_prefix_valid:bearerPrefix,
  material_nonempty:material.length>0,
  material_trimmed:material.length>0&&material===material.trim(),
  credential_material_present:false,
  authorization_value_present:false
 });
}

module.exports={EVIDENCE_VERSION,collectHermesMaintainerGithubAuthorizationShapeEvidence};
