'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { compareTranscriptionProviderCapabilities } = require('./transcription-provider-capability-comparator');
const { validateCapabilityProfile, SAFE_FLAGS } = require('./transcription-provider-capability-matrix');

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(value)));
}

function createTranscriptionProviderCapabilityCatalog(profiles = []) {
  const validProfiles = [];
  for (const profile of profiles) {
    const validation = validateCapabilityProfile(profile);
    if (!validation.valid) throw new Error(`invalid_capability_profile:${validation.errors.join(',')}`);
    validProfiles.push(cloneFrozen(profile));
  }
  const bySlug = new Map(validProfiles.map((profile) => [profile.provider_slug, profile]));

  return Object.freeze({
    listProviders() {
      return cloneFrozen([...bySlug.keys()].sort());
    },
    getProvider(providerSlug) {
      return bySlug.has(providerSlug) ? cloneFrozen(bySlug.get(providerSlug)) : null;
    },
    listLanguages() {
      return cloneFrozen(uniqueSorted(validProfiles.flatMap((profile) => profile.supported_languages)));
    },
    listFormats() {
      return cloneFrozen(uniqueSorted(validProfiles.flatMap((profile) => profile.supported_audio_formats)));
    },
    getCapabilities(providerSlug) {
      const profile = bySlug.get(providerSlug);
      if (!profile) return null;
      return cloneFrozen({
        provider_slug: providerSlug,
        capabilities: Object.keys(profile)
          .filter((field) => field.startsWith('supports_'))
          .sort()
          .reduce((acc, field) => ({ ...acc, [field]: profile[field] }), {}),
        ...SAFE_FLAGS
      });
    },
    compareProviders(leftSlug, rightSlug) {
      const left = bySlug.get(leftSlug);
      const right = bySlug.get(rightSlug);
      if (!left || !right) return cloneFrozen({ comparable: false, errors: ['provider_not_found'], ...SAFE_FLAGS });
      return compareTranscriptionProviderCapabilities(left, right);
    }
  });
}

module.exports = {
  createTranscriptionProviderCapabilityCatalog
};
