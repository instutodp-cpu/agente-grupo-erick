'use strict';

const https = require('node:https');
const { PassThrough } = require('node:stream');
const {
  ALLOWED_CONTENT_TYPES,
  REQUEST_LIMITS,
  normalizeContentType
} = require('../../core/public-web-transport-contract');

function normalizeRemoteAddress(address) {
  if (typeof address !== 'string') return '';
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length);
  return value;
}

function createPublicWebNodeHttpsClient(options = {}) {
  const requestFactory = options.requestFactory || https.request;
  const userAgent = 'HermesCorePublicWebCanary/1.0';

  async function execute(input = {}) {
    if (input.protocol !== 'https' || input.port !== 443) throw new Error('PUBLIC_WEB_HTTPS_ONLY');
    if (input.redirect_mode !== 'manual' || input.follow_redirects === true) throw new Error('PUBLIC_WEB_REDIRECT_MODE_INVALID');
    if (!input.approved_ip || !Array.isArray(input.approved_ips) || !input.approved_ips.includes(input.approved_ip)) throw new Error('PUBLIC_WEB_APPROVED_IP_REQUIRED');
    if (input.method && !['GET', 'HEAD'].includes(input.method)) throw new Error('PUBLIC_WEB_METHOD_BLOCKED');
    if (input.body || input.request_body || input.requestBody) throw new Error('PUBLIC_WEB_REQUEST_BODY_BLOCKED');
    if (input.abort_signal && input.abort_signal.aborted) throw new Error('PUBLIC_WEB_TIMEOUT');
    if (input.host_header !== input.hostname || input.server_name !== input.hostname) throw new Error('PUBLIC_WEB_HOST_BINDING_INVALID');

    return await new Promise((resolve, reject) => {
      const url = new URL(input.url);
      const method = input.method === 'HEAD' ? 'HEAD' : 'GET';
      const req = requestFactory({
        protocol: 'https:',
        host: input.hostname,
        hostname: input.hostname,
        servername: input.server_name || input.hostname,
        port: 443,
        method,
        path: `${url.pathname || '/'}${url.search || ''}`,
        lookup(hostname, _options, callback) {
          callback(null, input.approved_ip, input.approved_ip.includes(':') ? 6 : 4);
        },
        headers: {
          Host: input.host_header || input.hostname,
          'User-Agent': userAgent,
          Accept: ALLOWED_CONTENT_TYPES.join(', ')
        },
        rejectUnauthorized: true,
        timeout: input.timeout_ms || REQUEST_LIMITS.default_timeout_ms,
        agent: false,
        signal: input.abort_signal
      }, (res) => {
        const contentType = normalizeContentType(res.headers && res.headers['content-type']);
        const contentLength = Number(res.headers && res.headers['content-length']);
        const maxBytes = input.max_response_bytes || REQUEST_LIMITS.default_response_bytes;
        const remoteAddress = normalizeRemoteAddress(res.socket && res.socket.remoteAddress || '');
        const approvedIp = normalizeRemoteAddress(input.approved_ip);
        if (remoteAddress && remoteAddress !== approvedIp) {
          if (typeof res.destroy === 'function') res.destroy();
          req.destroy();
          reject(new Error('PUBLIC_WEB_DNS_REBINDING_BLOCKED'));
          return;
        }
        if (!contentType || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
          if (typeof res.destroy === 'function') res.destroy();
          req.destroy();
          reject(new Error('PUBLIC_WEB_CONTENT_TYPE_BLOCKED'));
          return;
        }
        if ((res.headers && Object.prototype.hasOwnProperty.call(res.headers, 'content-length')) && (!Number.isInteger(contentLength) || contentLength < 0)) {
          if (typeof res.destroy === 'function') res.destroy();
          req.destroy();
          reject(new Error('PUBLIC_WEB_PROVIDER_RESPONSE_INVALID'));
          return;
        }
        if (Number.isInteger(contentLength) && contentLength > maxBytes) {
          if (typeof res.destroy === 'function') res.destroy();
          req.destroy();
          reject(new Error('PUBLIC_WEB_RESPONSE_TOO_LARGE'));
          return;
        }
        const stream = new PassThrough();
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > maxBytes) {
            stream.destroy(new Error('PUBLIC_WEB_RESPONSE_TOO_LARGE'));
            if (typeof res.destroy === 'function') res.destroy();
            req.destroy(new Error('PUBLIC_WEB_RESPONSE_TOO_LARGE'));
            return;
          }
          stream.write(chunk);
        });
        res.on('end', () => stream.end());
        res.on('error', (error) => stream.destroy(error));
        resolve({
          status_code: res.statusCode,
          content_type: contentType,
          content_length: Number.isInteger(contentLength) ? contentLength : undefined,
          remote_address: remoteAddress || approvedIp,
          redirect_location: typeof (res.headers && res.headers.location) === 'string' ? res.headers.location : '',
          body_stream: stream
        });
      });
      req.on('timeout', () => {
        req.destroy(new Error('PUBLIC_WEB_TIMEOUT'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  return Object.freeze({
    execute
  });
}

module.exports = {
  createPublicWebNodeHttpsClient
};
