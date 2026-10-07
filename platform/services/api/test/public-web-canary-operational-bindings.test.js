'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {createPublicWebCanaryOperationalControls}=require('../src/pilots/public-web-canary-operational-controls');
const {createPublicWebCanaryOperationalBindings}=require('../src/pilots/public-web-canary-operational-bindings');
const {validatePublicWebStagingSecretReference}=require('../src/core/public-web-staging-secret-reference-contract');
const {CONNECTOR_ID,CONFIGURATION_ID}=require('../src/core/public-web-transport-contract');

test('operational bindings remain contractual and non-executing while staging reference is canonical',()=>{
 const controls=createPublicWebCanaryOperationalControls({environment:{}}); const b=createPublicWebCanaryOperationalBindings({controls,clock:()=> '2026-10-07T12:00:00.000Z'});
 const lifecycle=b.lifecycleRegistry.getConnector(CONNECTOR_ID); const config=b.configurationRegistry.getConfiguration(CONFIGURATION_ID); const ref=b.secretReferenceRegistry.getSecretReference(config.secret_reference_descriptors[0].reference_id);
 assert.equal(lifecycle.runtime_enabled,false); assert.equal(lifecycle.real_provider_enabled,false); assert.equal(lifecycle.execution_mode,'contract_only');
 assert.equal(b.readinessResult.simulated,true); assert.equal(b.readinessResult.executed,false); assert.equal(b.readinessResult.real_provider_called,false); assert.equal(b.readinessResult.can_trigger_real_execution,false);
 assert.equal(config.environment,'staging'); assert.equal(config.feature_flag_default,false); assert.equal(validatePublicWebStagingSecretReference(ref).valid,true); assert.equal(b.secretResolver.canResolve(ref),true);
});
