'use strict';

const dns = require('node:dns/promises');
const {
  isBlockedIp,
  isNonEmptyString,
  uniqueSorted
} = require('../../core/public-web-transport-contract');

function normalizeIp(ip) {
  return String(ip || '').trim().toLowerCase();
}

function createPublicWebSafeDnsResolver(options = {}) {
  const resolver = typeof options.resolver === 'function'
    ? options.resolver
    : async (hostname) => {
      const [a, aaaa] = await Promise.allSettled([
        dns.resolve4(hostname),
        dns.resolve6(hostname)
      ]);
      return [
        ...(a.status === 'fulfilled' ? a.value : []),
        ...(aaaa.status === 'fulfilled' ? aaaa.value : [])
      ];
    };

  async function resolve(hostname, context = {}) {
    if (!isNonEmptyString(hostname) || hostname.includes('/') || hostname.includes('@')) {
      return { allowed: false, reason: 'hostname_invalid', approved_ips: [], approved_ip: null };
    }
    const first = uniqueSorted((await resolver(hostname, context) || []).map(normalizeIp));
    if (first.length === 0) return { allowed: false, reason: 'dns_zero_results', approved_ips: [], approved_ip: null };
    const blocked = first.find((ip) => isBlockedIp(ip));
    if (blocked) return { allowed: false, reason: 'dns_private_or_reserved_ip', approved_ips: [], approved_ip: null };
    const second = uniqueSorted((await resolver(hostname, { ...context, revalidate: true }) || []).map(normalizeIp));
    if (second.length === 0) return { allowed: false, reason: 'dns_second_resolution_empty', approved_ips: [], approved_ip: null };
    if (second.length !== first.length || second.some((ip, index) => ip !== first[index])) {
      return { allowed: false, reason: 'dns_rebinding_detected', approved_ips: [], approved_ip: null };
    }
    return {
      allowed: true,
      reason: null,
      hostname,
      approved_ips: first,
      approved_ip: first[0],
      ttl_ms: Math.min(Number.isInteger(options.ttlMs) ? options.ttlMs : 30000, 30000),
      simulated: true,
      executed: false,
      real_provider_called: false
    };
  }

  function resolveSyncForPolicy(hostname) {
    if (typeof options.syncResolver !== 'function') return [];
    return options.syncResolver(hostname);
  }

  return Object.freeze({
    resolve,
    resolveSyncForPolicy
  });
}

module.exports = {
  createPublicWebSafeDnsResolver
};
