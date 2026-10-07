'use strict';

const publicWebAdapter = require('../adapters/public-web/public-web-read-only-adapter');
const { createReadOnlyAdapterRegistry } = require('../core/read-only-adapter-registry');
const { createPublicWebCanarySessionRegistry } = require('../core/public-web-canary-session-registry');
const { createPublicWebCanaryTargetAllowlist } = require('../core/public-web-canary-target-allowlist');
const { createPublicWebPilotBudget } = require('../core/public-web-pilot-gate');
const { createPublicWebCanaryOperatorPolicy } = require('../core/public-web-canary-operator-policy');
const { ADAPTER_ID, CONFIGURATION_ID, CONNECTOR_ID, PROVIDER_ID, READINESS_CANDIDATE_ID } = require('../core/public-web-transport-contract');
const { REFERENCE_ID } = require('./public-web-canary-operational-controls');

function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }

function createPublicWebCanaryOperationalBindings({ controls, clock } = {}) {
  if (!controls || !controls.secretReferenceRegistry || !controls.secretResolver) throw new TypeError('operational_controls_required');
  const adapterRegistry=createReadOnlyAdapterRegistry(); adapterRegistry.registerAdapter(publicWebAdapter);
  const lifecycle=Object.freeze({connector_id:CONNECTOR_ID,provider_id:PROVIDER_ID,adapter_id:ADAPTER_ID,readiness_candidate_id:READINESS_CANDIDATE_ID,lifecycle_state:'readiness_passed',lifecycle_version:1,workspace_types:['corporate'],operations:['fetch_public_page_summary'],feature_flag_key:'HERMES_PUBLIC_WEB_REAL_CANARY_ENABLED',feature_flag_default:false,kill_switch_key:'HERMES_PUBLIC_WEB_REAL_CANARY_KILL_SWITCH',runtime_enabled:false,real_provider_enabled:false,execution_mode:'contract_only',deprecated:false,retired:false});
  const configuration=Object.freeze({configuration_id:CONFIGURATION_ID,connector_id:CONNECTOR_ID,provider_id:PROVIDER_ID,adapter_id:ADAPTER_ID,readiness_candidate_id:READINESS_CANDIDATE_ID,workspace_type:'corporate',tenant_id:'grupo_erick',environment:'staging',configuration_status:'structurally_ready',readiness_status:'configuration_structurally_ready',configuration_version:1,feature_flag_key:'HERMES_PUBLIC_WEB_REAL_CANARY_ENABLED',feature_flag_default:false,kill_switch_key:'HERMES_PUBLIC_WEB_REAL_CANARY_KILL_SWITCH',kill_switch_required:true,disabled:false,deprecated:false,secret_reference_descriptors:[{reference_id:REFERENCE_ID,reference_type:'public_web_staging_opaque_reference'}],required_secret_names:['public_web_public_access_handle'],allowed_operations:['fetch_public_page_summary']});
  const readinessResult=Object.freeze({candidate_id:READINESS_CANDIDATE_ID,provider_id:PROVIDER_ID,adapter_id:ADAPTER_ID,status:'ready_for_real_read_only_pr',verdict:'allow_future_read_only_pr',ready:true,simulated:true,executed:false,real_provider_called:false,can_trigger_real_execution:false,blocking_requirements:[],blocking_reasons:[]});
  return Object.freeze({canarySessionRegistry:createPublicWebCanarySessionRegistry({clock}),targetAllowlist:createPublicWebCanaryTargetAllowlist({clock}),adapterRegistry,lifecycleRegistry:Object.freeze({getConnector:id=>id===CONNECTOR_ID?clone(lifecycle):null}),configurationRegistry:Object.freeze({getConfiguration:id=>id===CONFIGURATION_ID?clone(configuration):null}),secretReferenceRegistry:controls.secretReferenceRegistry,secretResolver:controls.secretResolver,readinessResult,rateLimitBudget:createPublicWebPilotBudget({clock}),costBudget:createPublicWebPilotBudget({clock}),operatorPolicy:createPublicWebCanaryOperatorPolicy(),clock,lifecycle,configuration});
}
module.exports={createPublicWebCanaryOperationalBindings};
