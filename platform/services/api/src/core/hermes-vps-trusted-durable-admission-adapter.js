'use strict';

const TRUSTED_ADAPTER_BRAND = Symbol('hermes-vps-trusted-durable-admission-adapter');
const TRUSTED_ADAPTER_INTERFACE_VERSION = 'hermes-vps-trusted-durable-admission-adapter-v1';

function isTrustedDurableAtomicAdmissionAdapter(value) {
  return Boolean(value && value.interface_version === TRUSTED_ADAPTER_INTERFACE_VERSION && value.durability_claim === 'ADAPTER_OWNER_RESPONSIBILITY' && value[TRUSTED_ADAPTER_BRAND] === true && typeof value.atomicConsumeExecutionAdmission === 'function');
}

module.exports = {
  TRUSTED_ADAPTER_INTERFACE_VERSION,
  isTrustedDurableAtomicAdmissionAdapter
};
