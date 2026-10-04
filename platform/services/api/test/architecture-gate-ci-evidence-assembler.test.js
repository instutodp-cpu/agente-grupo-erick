'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {assembleArchitectureGateEvidenceFromCi}=require('../src/core/architecture-gate-ci-evidence-assembler');
const HEAD='b976c373ea6df625c4da6127faa587181def8abf';
const BASE='043f2a80cf97ed1099fdf139ab0254e39fd5e13c';
function envelope(overrides={}){return {
 architecture_gate_evidence_reference_id:'ci-evidence-b976c37',repository_id:'repo-agente-grupo-erick',
 repository_full_name:'instutodp-cpu/agente-grupo-erick',default_branch:'main',commit_sha:HEAD,head_commit_sha:HEAD,base_commit_sha:BASE,
 workflow_id:'hermes-core-smoke',workflow_name:'Hermes Core smoke test',workflow_version:'v1',workflow_run_id:'37226509013',workflow_run_attempt:1,
 workflow_run_status:'COMPLETED',workflow_run_conclusion:'SUCCESS',trigger_type:'PULL_REQUEST_REFERENCE',ruleset_id:'hermes-core-smoke',ruleset_version:'1',
 gates:[{gate_result_id:'hermes-core-smoke-success',gate_id:'HERMES_CORE_SMOKE',gate_version:'v1',status:'PASSED',severity:'CRITICAL',required:true}],
 evidence_created_logical_sequence:0,maximum_valid_sequences:1000,current_logical_sequence:1,...overrides};}
test('assembles externally verified CI evidence without granting production authority',()=>{const e=assembleArchitectureGateEvidenceFromCi(envelope());assert.equal(e.commit_sha,HEAD);assert.equal(e.workflow_run_reference.workflow_run_id,'37226509013');assert.equal(e.evidence_validated,true);assert.equal(e.simulation,true);assert.equal(e.production_blocked,true);assert.equal(e.evidence_applied,false);});
test('fails closed when commit and workflow head diverge',()=>assert.throws(()=>assembleArchitectureGateEvidenceFromCi(envelope({head_commit_sha:'a'.repeat(40)})),/commit_sha_head_mismatch/));
test('fails closed when workflow is not completed successfully',()=>{assert.throws(()=>assembleArchitectureGateEvidenceFromCi(envelope({workflow_run_status:'IN_PROGRESS'})),/workflow_run_not_completed/);assert.throws(()=>assembleArchitectureGateEvidenceFromCi(envelope({workflow_run_conclusion:'FAILURE'})),/workflow_run_not_successful/);});
test('fails closed when required gate is not passed',()=>assert.throws(()=>assembleArchitectureGateEvidenceFromCi(envelope({gates:[{gate_id:'HERMES_CORE_SMOKE',gate_version:'v1',status:'FAILED',required:true}]})),/required_gate_not_passed/));
