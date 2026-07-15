'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const PROVIDER_ID = 'public_web_provider_candidate';
const ADAPTER_ID = 'public_web_read_only_adapter_v1';
const READINESS_CANDIDATE_ID = 'public_web_read_only_candidate_v1';
const CONNECTOR_ID = 'public_web_read_only_connector_v1';
const CONFIGURATION_ID = 'public_web_read_only_configuration_v1';

const PILOT_MODES = [
  'disabled',
  'fixture_only',
  'mock_transport',
  'non_production_candidate',
  'canary_pending',
  'canary_blocked',
  'canary_allowed',
  'production_blocked',
  'kill_switch_blocked'
];

const ALLOWED_OPERATIONS = [
  'fetch_public_page_summary',
  'fetch_public_metadata',
  'search_public_information',
  'compare_public_results',
  'inspect_public_price',
  'inspect_public_promotion',
  'inspect_public_supplier',
  'inspect_public_competitor',
  'inspect_public_travel_listing',
  'inspect_public_hotel_listing',
  'inspect_public_documentation',
  'inspect_public_government_page',
  'inspect_public_regulatory_page'
];

const BLOCKED_OPERATIONS = [
  'login',
  'authenticate',
  'submit_form',
  'create_account',
  'reset_password',
  'add_to_cart',
  'checkout',
  'purchase',
  'reserve',
  'book',
  'pay',
  'upload',
  'post',
  'comment',
  'message',
  'send',
  'publish',
  'delete',
  'update',
  'modify',
  'crawl_private_area',
  'bypass_paywall',
  'bypass_captcha',
  'execute_javascript',
  'browser_automation',
  'download_executable'
];

const ALLOWED_SOURCE_TYPES = [
  'public_product_page',
  'public_price_page',
  'public_supplier_page',
  'public_competitor_page',
  'public_market_article',
  'public_documentation_page',
  'public_travel_listing',
  'public_hotel_listing',
  'public_promotion_page',
  'public_search_result_summary',
  'public_government_page',
  'public_regulatory_page'
];

const BLOCKED_SOURCE_TYPES = [
  'authenticated_page',
  'private_dashboard',
  'customer_portal',
  'employee_portal',
  'bank_portal',
  'payment_page',
  'checkout_page',
  'cart_page',
  'order_creation_page',
  'login_page',
  'password_reset_page',
  'private_api_response',
  'raw_social_dm',
  'private_social_content',
  'age_restricted_content',
  'sensitive_personal_data_page',
  'confidential_document',
  'malware_or_phishing_page'
];

const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'application/json',
  'text/plain',
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml'
];

const BLOCKED_CONTENT_TYPES = [
  'application/octet-stream',
  'application/zip',
  'application/x-msdownload',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'multipart/form-data',
  'image/png',
  'image/jpeg',
  'audio/mpeg',
  'video/mp4'
];

const BLOCKED_SCHEMES = [
  'file',
  'ftp',
  'gopher',
  'data',
  'javascript',
  'blob',
  'ws',
  'wss'
];

const CLOUD_METADATA_HOSTS = [
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.azure.internal',
  'metadata',
  'instance-data',
  'metadata.aws.internal'
];

const PUBLIC_WEB_STATUSES = [
  'public_web_fixture_success',
  'public_web_mock_success',
  'public_web_candidate_success',
  'public_web_validation_blocked',
  'public_web_target_blocked',
  'public_web_ssrf_blocked',
  'public_web_redirect_blocked',
  'public_web_content_type_blocked',
  'public_web_response_too_large',
  'public_web_timeout',
  'public_web_rate_limited',
  'public_web_provider_error_safe',
  'public_web_kill_switch_active',
  'public_web_feature_flag_off',
  'public_web_readiness_blocked',
  'public_web_configuration_blocked',
  'public_web_lifecycle_blocked',
  'public_web_production_blocked',
  'public_web_internal_error_safe'
];

const PUBLIC_WEB_ERROR_CODES = [
  'INVALID_PUBLIC_WEB_REQUEST',
  'PUBLIC_WEB_ADAPTER_DISABLED',
  'PUBLIC_WEB_FEATURE_FLAG_OFF',
  'PUBLIC_WEB_KILL_SWITCH_ACTIVE',
  'PUBLIC_WEB_READINESS_REQUIRED',
  'PUBLIC_WEB_CONFIGURATION_NOT_READY',
  'PUBLIC_WEB_LIFECYCLE_NOT_ELIGIBLE',
  'PUBLIC_WEB_TARGET_INVALID',
  'PUBLIC_WEB_SCHEME_BLOCKED',
  'PUBLIC_WEB_HOST_BLOCKED',
  'PUBLIC_WEB_PORT_BLOCKED',
  'PUBLIC_WEB_PRIVATE_IP_BLOCKED',
  'PUBLIC_WEB_LOCALHOST_BLOCKED',
  'PUBLIC_WEB_DNS_REBINDING_BLOCKED',
  'PUBLIC_WEB_REDIRECT_BLOCKED',
  'PUBLIC_WEB_CONTENT_TYPE_BLOCKED',
  'PUBLIC_WEB_RESPONSE_TOO_LARGE',
  'PUBLIC_WEB_TIMEOUT',
  'PUBLIC_WEB_RATE_LIMITED',
  'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID',
  'PUBLIC_WEB_UNSAFE_CONTENT',
  'PUBLIC_WEB_OPERATION_BLOCKED',
  'PUBLIC_WEB_PRODUCTION_BLOCKED',
  'PUBLIC_WEB_INTERNAL_ERROR'
];

const TRANSPORT_KINDS = ['fixture', 'mock', 'real_candidate'];

const REQUIRED_TRANSPORT_METADATA_FIELDS = [
  'transport_id',
  'provider_id',
  'transport_kind',
  'version',
  'environments',
  'supports_abort',
  'supports_stream_limit',
  'supports_redirect_control',
  'max_timeout_ms',
  'max_response_bytes',
  'real_network',
  'enabled'
];

const REQUIRED_REQUEST_FIELDS = [
  'trace_id',
  'request_id',
  'connector_id',
  'configuration_id',
  'adapter_id',
  'provider_id',
  'readiness_candidate_id',
  'workspace_type',
  'tenant_id',
  'user_id',
  'domain',
  'capability',
  'operation',
  'target',
  'source_type',
  'query',
  'max_results',
  'requested_content_types',
  'freshness_requirement',
  'timeout_ms',
  'max_response_bytes',
  'redirect_policy',
  'requested_at',
  'simulated',
  'executed',
  'real_provider_called',
  'write_allowed',
  'action_allowed',
  'send_allowed',
  'publish_allowed',
  'delete_allowed'
];

const REQUIRED_RESPONSE_FIELDS = [
  'trace_id',
  'request_id',
  'connector_id',
  'configuration_id',
  'adapter_id',
  'provider_id',
  'status',
  'source_type',
  'requested_target_hash',
  'final_target_origin',
  'content_type',
  'http_status_class',
  'result_count',
  'safe_summary',
  'structured_results',
  'freshness_hint',
  'confidence_hint',
  'warnings',
  'duration_ms',
  'bytes_received',
  'redirects_followed',
  'rate_limit_metadata',
  'cost_metadata',
  'simulated',
  'executed',
  'real_provider_called',
  'can_trigger_real_execution',
  'error',
  'audit_event_candidate'
];

const FORBIDDEN_FIELDS = [
  'token',
  'secret',
  'secret_handle',
  'env',
  'headers',
  'cookies',
  'credentials',
  'authorization',
  'password',
  'apiKey',
  'accessToken',
  'refreshToken',
  'payload',
  'rawPayload',
  'rawMessage',
  'userMessage',
  'requestBody',
  'responseBody',
  'rawHtml',
  'html',
  'body',
  'rawBody',
  'providerRawResponse',
  'provider_response',
  'privateUrl',
  'stackTrace'
];

const REQUEST_LIMITS = Object.freeze({
  default_timeout_ms: 8000,
  maximum_timeout_ms: 15000,
  default_response_bytes: 1048576,
  maximum_response_bytes: 2097152,
  maximum_redirects: 2,
  maximum_results: 10,
  maximum_summary_chars: 4000,
  maximum_result_item_chars: 2000,
  maximum_total_sanitized_output_chars: 12000,
  maximum_url_chars: 2048
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(isNonEmptyString))].sort();
}

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function findForbiddenFields(value) {
  const found = [];
  const forbidden = new Set(FORBIDDEN_FIELDS);

  function visit(entry) {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (!isPlainObject(entry)) return;
    for (const [key, nested] of Object.entries(entry)) {
      if (forbidden.has(key)) {
        found.push(`forbidden_field::${key}`);
        continue;
      }
      visit(nested);
    }
  }

  visit(value);
  return uniqueSorted(found);
}

function sanitizeObject(value) {
  if (Array.isArray(value)) return value.map(sanitizeObject);
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.includes(key)) continue;
    output[key] = sanitizeObject(nested);
  }
  return output;
}

function isBlockedOperation(operation) {
  const normalized = String(operation || '').toLowerCase();
  return BLOCKED_OPERATIONS.some((term) => normalized.includes(term));
}

function normalizeContentType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function isBlockedIPv4(ip) {
  const parts = String(ip).split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224 && a <= 239) return true;
  if (a >= 240) return true;
  return false;
}

function isBlockedIPv6(ip) {
  const normalized = String(ip || '').toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.includes('ffff:')) {
    const mapped = normalized.split(':').pop();
    if (net.isIP(mapped) === 4) return isBlockedIPv4(mapped);
  }
  if (normalized.startsWith('2001:db8')) return true;
  return false;
}

function isBlockedIp(ip) {
  const type = net.isIP(String(ip || ''));
  if (type === 4) return isBlockedIPv4(ip);
  if (type === 6) return isBlockedIPv6(ip);
  return true;
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

function parseTarget(target) {
  try {
    return new URL(target);
  } catch (_error) {
    return null;
  }
}

function validatePublicWebTarget(target, options = {}) {
  const errors = [];
  if (!isNonEmptyString(target)) return { valid: false, errors: ['target_missing'] };
  if (target.length > REQUEST_LIMITS.maximum_url_chars) errors.push('target_too_long');

  const url = parseTarget(target);
  if (!url) return { valid: false, errors: ['target_parse_failed'] };
  const scheme = url.protocol.replace(':', '').toLowerCase();
  const host = url.hostname.toLowerCase();
  const transportKind = options.transport_kind || 'real_candidate';

  if (BLOCKED_SCHEMES.includes(scheme)) errors.push(`scheme_blocked::${scheme}`);
  if (!['https', 'http'].includes(scheme)) errors.push(`scheme_blocked::${scheme}`);
  if (transportKind === 'real_candidate' && scheme !== 'https') errors.push('https_required_for_real_candidate');
  if (url.username || url.password) errors.push('url_credentials_blocked');
  if (!host) errors.push('host_missing');
  if (host === 'localhost' || host.endsWith('.localhost')) errors.push('localhost_blocked');
  if (CLOUD_METADATA_HOSTS.includes(host)) errors.push('cloud_metadata_host_blocked');
  if (!/^[a-z0-9.-]+$/.test(host) && net.isIP(host) === 0) errors.push('host_characters_invalid');
  if (!host.includes('.') && net.isIP(host) === 0) errors.push('public_domain_required');

  const explicitPort = url.port ? Number(url.port) : null;
  if (transportKind === 'real_candidate') {
    if (explicitPort !== null && explicitPort !== 443) errors.push('port_blocked');
  } else if (explicitPort !== null && ![80, 443].includes(explicitPort)) {
    errors.push('port_blocked');
  }

  if (net.isIP(host) && isBlockedIp(host)) errors.push('private_ip_blocked');

  const dnsResolver = options.dnsResolver;
  let resolvedIps = [];
  if (typeof dnsResolver !== 'function') {
    errors.push('dns_resolver_required');
  } else {
    const resolved = dnsResolver(host);
    resolvedIps = Array.isArray(resolved) ? resolved.slice() : [];
    if (resolvedIps.length === 0) errors.push('host_without_ip_resolution');
    for (const ip of resolvedIps) {
      if (isBlockedIp(ip)) errors.push(`resolved_ip_blocked::${ip}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: uniqueSorted(errors),
    normalized_url: `${url.protocol}//${url.host}${url.pathname}`,
    origin: url.origin,
    protocol: scheme,
    hostname: host,
    resolved_ips: resolvedIps
  };
}

function validateRedirectChain(target, redirects = [], options = {}) {
  const errors = [];
  if (!Array.isArray(redirects)) return ['redirects_must_be_array'];
  const maxRedirects = Number.isInteger(options.max_redirects) ? options.max_redirects : 0;
  if (redirects.length > maxRedirects) errors.push('redirect_limit_exceeded');
  const seen = new Set([target]);
  let previous = parseTarget(target);
  for (const redirect of redirects) {
    const current = parseTarget(redirect);
    if (!current) {
      errors.push('redirect_target_invalid');
      continue;
    }
    if (seen.has(redirect)) errors.push('redirect_loop_blocked');
    seen.add(redirect);
    if (previous && previous.protocol === 'https:' && current.protocol === 'http:') {
      errors.push('redirect_https_downgrade_blocked');
    }
    const validation = validatePublicWebTarget(redirect, options);
    if (!validation.valid) errors.push(...validation.errors.map((error) => `redirect_${error}`));
    previous = current;
  }
  return uniqueSorted(errors);
}

function stripUnsafeMarkup(input) {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<input[\s\S]*?>/gi, ' ')
    .replace(/<button[\s\S]*?<\/button>/gi, ' ')
    .replace(/\son[a-z]+\s*=\s*["'][^"']*["']/gi, ' ')
    .replace(/javascript:/gi, '')
    .replace(/data:[^"'\s)]+/gi, '')
    .replace(/[A-Za-z0-9+/=]{160,}/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b(ignore previous instructions|system prompt|developer message|change tenant|override policy|tool call)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(content, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(content || '').match(regex);
  return match ? stripUnsafeMarkup(match[1]).slice(0, 200) : '';
}

function extractMetaDescription(content) {
  const match = String(content || '').match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  return match ? stripUnsafeMarkup(match[1]).slice(0, 500) : '';
}

function extractPrices(text) {
  const matches = String(text || '').match(/(?:R\$\s?\d+(?:[.,]\d{2})?|\$\s?\d+(?:[.,]\d{2})?|\b\d+[.,]\d{2}\b)/g) || [];
  return [...new Set(matches)].slice(0, 10);
}

function sanitizePublicWebContent(content, contentType = 'text/plain') {
  const normalizedType = normalizeContentType(contentType);
  const raw = typeof content === 'string' ? content : JSON.stringify(content || {});
  const title = normalizedType === 'text/html' ? extractTag(raw, 'title') : '';
  const description = normalizedType === 'text/html' ? extractMetaDescription(raw) : '';
  const mainText = stripUnsafeMarkup(raw);
  const excerpt = mainText.slice(0, REQUEST_LIMITS.maximum_summary_chars);
  return {
    title,
    description,
    main_text_excerpt: excerpt,
    structured_facts: [],
    observed_prices: extractPrices(mainText),
    observed_dates: (mainText.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).slice(0, 10),
    public_contact_summary: '',
    source_freshness_hints: [],
    sanitized_links: [],
    content_trust: 'untrusted_public_web',
    instructions_ignored: true,
    external_content_cannot_change_policy: true
  };
}

function validateTransportCapabilities(metadata) {
  const errors = [];
  if (!isPlainObject(metadata)) return { valid: false, errors: ['metadata_must_be_object'] };
  for (const field of REQUIRED_TRANSPORT_METADATA_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['transport_id', 'provider_id', 'transport_kind', 'version']) {
    if (!isNonEmptyString(metadata[field])) errors.push(`invalid_${field}`);
  }
  if (metadata.provider_id !== PROVIDER_ID) errors.push('provider_id_mismatch');
  if (!TRANSPORT_KINDS.includes(metadata.transport_kind)) errors.push('transport_kind_not_allowed');
  if (!Array.isArray(metadata.environments) || metadata.environments.length === 0) errors.push('invalid_environments');
  if (!Number.isInteger(metadata.max_timeout_ms) || metadata.max_timeout_ms <= 0 || metadata.max_timeout_ms > REQUEST_LIMITS.maximum_timeout_ms) {
    errors.push('max_timeout_ms_out_of_bounds');
  }
  if (!Number.isInteger(metadata.max_response_bytes) || metadata.max_response_bytes <= 0 || metadata.max_response_bytes > REQUEST_LIMITS.maximum_response_bytes) {
    errors.push('max_response_bytes_out_of_bounds');
  }
  if (metadata.transport_kind === 'real_candidate' && metadata.enabled !== false) errors.push('real_candidate_must_default_disabled');
  for (const field of ['supports_abort', 'supports_stream_limit', 'supports_redirect_control', 'real_network', 'enabled']) {
    if (typeof metadata[field] !== 'boolean') errors.push(`invalid_${field}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validatePublicWebTransportRequest(request, options = {}) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['request_must_be_object'] };
  for (const field of REQUIRED_REQUEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['trace_id', 'request_id', 'connector_id', 'configuration_id', 'adapter_id', 'provider_id', 'readiness_candidate_id', 'workspace_type', 'tenant_id', 'user_id', 'domain', 'capability', 'operation', 'target', 'source_type', 'requested_at']) {
    if (!isNonEmptyString(request[field])) errors.push(`invalid_${field}`);
  }
  if (request.connector_id !== CONNECTOR_ID) errors.push('connector_id_mismatch');
  if (request.configuration_id !== CONFIGURATION_ID) errors.push('configuration_id_mismatch');
  if (request.adapter_id !== ADAPTER_ID) errors.push('adapter_id_mismatch');
  if (request.provider_id !== PROVIDER_ID) errors.push('provider_id_mismatch');
  if (request.readiness_candidate_id !== READINESS_CANDIDATE_ID) errors.push('readiness_candidate_id_mismatch');
  if (!ALLOWED_OPERATIONS.includes(request.operation)) errors.push('operation_not_allowed');
  if (isBlockedOperation(request.operation)) errors.push(`blocked_operation::${request.operation}`);
  if (!ALLOWED_SOURCE_TYPES.includes(request.source_type)) errors.push('source_type_not_allowed');
  if (BLOCKED_SOURCE_TYPES.includes(request.source_type)) errors.push('source_type_blocked');
  if (!Array.isArray(request.requested_content_types) || request.requested_content_types.some((type) => !ALLOWED_CONTENT_TYPES.includes(type))) {
    errors.push('requested_content_types_invalid');
  }
  if (!Number.isInteger(request.max_results) || request.max_results < 1 || request.max_results > REQUEST_LIMITS.maximum_results) errors.push('max_results_out_of_bounds');
  if (!Number.isInteger(request.timeout_ms) || request.timeout_ms < 1 || request.timeout_ms > REQUEST_LIMITS.maximum_timeout_ms) errors.push('timeout_ms_out_of_bounds');
  if (!Number.isInteger(request.max_response_bytes) || request.max_response_bytes < 1 || request.max_response_bytes > REQUEST_LIMITS.maximum_response_bytes) errors.push('max_response_bytes_out_of_bounds');
  if (!isPlainObject(request.redirect_policy)) errors.push('redirect_policy_invalid');
  if (request.simulated !== true) errors.push('simulated_must_be_true');
  if (request.executed !== false) errors.push('executed_must_be_false');
  if (request.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  for (const field of ['write_allowed', 'action_allowed', 'send_allowed', 'publish_allowed', 'delete_allowed']) {
    if (request[field] !== false) errors.push(`${field}_must_be_false`);
  }
  const targetValidation = validatePublicWebTarget(request.target, {
    transport_kind: options.transport_kind || 'real_candidate',
    dnsResolver: options.dnsResolver
  });
  if (!targetValidation.valid) errors.push(...targetValidation.errors);
  errors.push(...findForbiddenFields(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors), target: targetValidation };
}

function validatePublicWebTransportResponse(response) {
  const errors = [];
  if (!isPlainObject(response)) return { valid: false, errors: ['response_must_be_object'] };
  for (const field of REQUIRED_RESPONSE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(response, field)) errors.push(`missing_${field}`);
  }
  if (!PUBLIC_WEB_STATUSES.includes(response.status)) errors.push('status_not_allowed');
  if (!ALLOWED_CONTENT_TYPES.includes(normalizeContentType(response.content_type))) errors.push('content_type_not_allowed');
  if (!Array.isArray(response.structured_results)) errors.push('structured_results_must_be_array');
  if (response.simulated !== true) errors.push('simulated_must_be_true');
  if (response.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  if (response.can_trigger_real_execution !== false) errors.push('can_trigger_real_execution_must_be_false');
  errors.push(...findForbiddenFields(response));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildSafeTransportError(code, message, context = {}) {
  const errorCode = PUBLIC_WEB_ERROR_CODES.includes(code) ? code : 'PUBLIC_WEB_INTERNAL_ERROR';
  return {
    error_code: errorCode,
    message: isNonEmptyString(message) ? message : 'Public web operation blocked safely.',
    blocked_reason: isNonEmptyString(context.blocked_reason) ? context.blocked_reason : errorCode
  };
}

function buildPublicWebAuditEvent(context = {}) {
  return {
    event_name: 'public_web_read_only_adapter_pilot_evaluated',
    trace_id: context.trace_id || 'trace_not_available',
    request_id: context.request_id || 'request_not_available',
    connector_id: context.connector_id || CONNECTOR_ID,
    configuration_id: context.configuration_id || CONFIGURATION_ID,
    adapter_id: context.adapter_id || ADAPTER_ID,
    provider_id: context.provider_id || PROVIDER_ID,
    workspace_type: context.workspace_type || 'workspace_not_available',
    tenant_id: context.tenant_id || 'tenant_not_available',
    user_id: context.user_id || 'user_not_available',
    domain: context.domain || 'domain_not_available',
    capability: context.capability || 'capability_not_available',
    operation: context.operation || 'operation_not_available',
    source_type: context.source_type || 'source_not_available',
    target_origin_hash: context.target_origin_hash || 'target_not_available',
    status: context.status || 'public_web_internal_error_safe',
    blocked_reason: context.blocked_reason || null,
    environment: context.environment || 'unknown',
    feature_flag_state: context.feature_flag_state === true,
    kill_switch_state: context.kill_switch_state === true,
    lifecycle_state: context.lifecycle_state || 'unknown',
    readiness_state: context.readiness_state || 'unknown',
    configuration_state: context.configuration_state || 'unknown',
    canary_state: context.canary_state || 'blocked',
    rollout_percentage: Number.isFinite(context.rollout_percentage) ? context.rollout_percentage : 0,
    simulated: true,
    executed: context.executed === true,
    real_provider_called: false,
    duration_ms: Number.isInteger(context.duration_ms) && context.duration_ms >= 0 ? context.duration_ms : 0,
    bytes_received: Number.isInteger(context.bytes_received) && context.bytes_received >= 0 ? context.bytes_received : 0,
    redirects_followed: Number.isInteger(context.redirects_followed) && context.redirects_followed >= 0 ? context.redirects_followed : 0,
    result_count: Number.isInteger(context.result_count) && context.result_count >= 0 ? context.result_count : 0,
    cost_units: Number.isFinite(context.cost_units) ? context.cost_units : 0,
    occurred_at: context.occurred_at || new Date(0).toISOString()
  };
}

function buildTransportEnvelope(request, fields = {}) {
  const targetValidation = fields.targetValidation || validatePublicWebTarget(request && request.target, {
    transport_kind: fields.transport_kind || 'fixture',
    dnsResolver: fields.dnsResolver || (() => ['93.184.216.34'])
  });
  const status = fields.status || 'public_web_provider_error_safe';
  const contentType = normalizeContentType(fields.content_type || 'text/plain');
  const structuredResults = Array.isArray(fields.structured_results) ? fields.structured_results : [];
  const targetHash = hashValue(targetValidation.origin || (request && request.target));
  const error = fields.error_code ? buildSafeTransportError(fields.error_code, 'Public web operation blocked safely.', { blocked_reason: fields.blocked_reason }) : null;
  const response = {
    trace_id: request && request.trace_id || 'trace_not_available',
    request_id: request && request.request_id || 'request_not_available',
    connector_id: request && request.connector_id || CONNECTOR_ID,
    configuration_id: request && request.configuration_id || CONFIGURATION_ID,
    adapter_id: request && request.adapter_id || ADAPTER_ID,
    provider_id: request && request.provider_id || PROVIDER_ID,
    status,
    source_type: request && request.source_type || 'public_search_result_summary',
    requested_target_hash: targetHash,
    final_target_origin: targetValidation.origin || 'target_not_available',
    content_type: contentType,
    http_status_class: fields.http_status_class || '2xx',
    result_count: structuredResults.length,
    safe_summary: String(fields.safe_summary || 'Synthetic public web result.').slice(0, REQUEST_LIMITS.maximum_summary_chars),
    structured_results: structuredResults.map((item) => sanitizeObject(item)).slice(0, REQUEST_LIMITS.maximum_results),
    freshness_hint: fields.freshness_hint || 'synthetic_fixture',
    confidence_hint: fields.confidence_hint || 'medium',
    warnings: uniqueSorted(fields.warnings || []),
    duration_ms: Number.isInteger(fields.duration_ms) ? fields.duration_ms : 0,
    bytes_received: Number.isInteger(fields.bytes_received) ? fields.bytes_received : 0,
    redirects_followed: Number.isInteger(fields.redirects_followed) ? fields.redirects_followed : 0,
    rate_limit_metadata: sanitizeObject(fields.rate_limit_metadata || { policy: 'synthetic', retry_performed: false }),
    cost_metadata: sanitizeObject(fields.cost_metadata || { cost_units: 0, budget_source: 'synthetic' }),
    simulated: true,
    executed: fields.executed === true,
    real_provider_called: false,
    can_trigger_real_execution: false,
    error,
    audit_event_candidate: buildPublicWebAuditEvent({
      ...(request || {}),
      status,
      target_origin_hash: targetHash,
      blocked_reason: fields.blocked_reason || null,
      environment: fields.environment || 'local_test',
      feature_flag_state: fields.feature_flag_state === true,
      kill_switch_state: fields.kill_switch_state === true,
      lifecycle_state: fields.lifecycle_state,
      readiness_state: fields.readiness_state,
      configuration_state: fields.configuration_state,
      canary_state: fields.canary_state,
      rollout_percentage: fields.rollout_percentage,
      executed: fields.executed === true,
      duration_ms: fields.duration_ms,
      bytes_received: fields.bytes_received,
      redirects_followed: fields.redirects_followed,
      result_count: structuredResults.length,
      cost_units: fields.cost_units || 0,
      occurred_at: fields.occurred_at
    })
  };
  return sanitizeObject(response);
}

function sanitizeTransportResponse(rawResponse, request = {}, options = {}) {
  if (!isPlainObject(rawResponse)) {
    return buildTransportEnvelope(request, {
      status: 'public_web_provider_error_safe',
      error_code: 'PUBLIC_WEB_PROVIDER_RESPONSE_INVALID',
      blocked_reason: 'provider_response_invalid'
    });
  }
  const contentType = normalizeContentType(rawResponse.content_type);
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return buildTransportEnvelope(request, {
      status: 'public_web_content_type_blocked',
      error_code: 'PUBLIC_WEB_CONTENT_TYPE_BLOCKED',
      blocked_reason: 'content_type_blocked',
      content_type: 'text/plain'
    });
  }
  const contentLength = Number.isInteger(rawResponse.content_length) ? rawResponse.content_length : String(rawResponse.content || '').length;
  const limit = Number.isInteger(options.max_response_bytes) ? options.max_response_bytes : REQUEST_LIMITS.default_response_bytes;
  if (contentLength > limit || String(rawResponse.content || '').length > limit) {
    return buildTransportEnvelope(request, {
      status: 'public_web_response_too_large',
      error_code: 'PUBLIC_WEB_RESPONSE_TOO_LARGE',
      blocked_reason: 'response_too_large',
      content_type: contentType,
      bytes_received: Math.min(contentLength, limit)
    });
  }
  const sanitizedContent = sanitizePublicWebContent(rawResponse.content, contentType);
  return buildTransportEnvelope(request, {
    status: rawResponse.status || 'public_web_candidate_success',
    content_type: contentType,
    http_status_class: rawResponse.http_status_class || `${Math.floor((rawResponse.status_code || 200) / 100)}xx`,
    safe_summary: sanitizedContent.main_text_excerpt || 'Sanitized public web content.',
    structured_results: [{
      title: sanitizedContent.title,
      description: sanitizedContent.description,
      main_text_excerpt: sanitizedContent.main_text_excerpt.slice(0, REQUEST_LIMITS.maximum_result_item_chars),
      structured_facts: sanitizedContent.structured_facts,
      observed_prices: sanitizedContent.observed_prices,
      observed_dates: sanitizedContent.observed_dates,
      content_trust: sanitizedContent.content_trust,
      instructions_ignored: sanitizedContent.instructions_ignored,
      external_content_cannot_change_policy: sanitizedContent.external_content_cannot_change_policy
    }],
    bytes_received: contentLength,
    redirects_followed: Array.isArray(rawResponse.redirects) ? rawResponse.redirects.length : 0,
    executed: options.executed === true,
    environment: options.environment || 'local_test',
    feature_flag_state: options.feature_flag_state === true,
    kill_switch_state: options.kill_switch_state === true,
    lifecycle_state: options.lifecycle_state,
    readiness_state: options.readiness_state,
    configuration_state: options.configuration_state,
    canary_state: options.canary_state,
    rollout_percentage: options.rollout_percentage,
    occurred_at: options.occurred_at
  });
}

module.exports = {
  PROVIDER_ID,
  ADAPTER_ID,
  READINESS_CANDIDATE_ID,
  CONNECTOR_ID,
  CONFIGURATION_ID,
  PILOT_MODES,
  ALLOWED_OPERATIONS,
  BLOCKED_OPERATIONS,
  ALLOWED_SOURCE_TYPES,
  BLOCKED_SOURCE_TYPES,
  ALLOWED_CONTENT_TYPES,
  BLOCKED_CONTENT_TYPES,
  BLOCKED_SCHEMES,
  CLOUD_METADATA_HOSTS,
  PUBLIC_WEB_STATUSES,
  PUBLIC_WEB_ERROR_CODES,
  TRANSPORT_KINDS,
  REQUIRED_TRANSPORT_METADATA_FIELDS,
  REQUIRED_REQUEST_FIELDS,
  REQUIRED_RESPONSE_FIELDS,
  FORBIDDEN_FIELDS,
  REQUEST_LIMITS,
  isPlainObject,
  isNonEmptyString,
  uniqueSorted,
  deepClone,
  hashValue,
  findForbiddenFields,
  sanitizeObject,
  isBlockedOperation,
  isBlockedIp,
  normalizeContentType,
  validatePublicWebTarget,
  validateRedirectChain,
  sanitizePublicWebContent,
  validatePublicWebTransportRequest,
  validatePublicWebTransportResponse,
  buildSafeTransportError,
  buildPublicWebAuditEvent,
  buildTransportEnvelope,
  sanitizeTransportResponse,
  validateTransportCapabilities
};
