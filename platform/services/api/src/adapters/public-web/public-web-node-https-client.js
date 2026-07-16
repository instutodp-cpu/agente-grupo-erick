'use strict';

const https = require('node:https');
const { PassThrough } = require('node:stream');
const {
  ALLOWED_CONTENT_TYPES,
  REQUEST_LIMITS,
  normalizeContentType
} = require('../../core/public-web-transport-contract');

function createPublicWebNodeHttpsClient(options = {}) {
  const requestFactory = options.requestFactory || https.request;
  const userAgent = 'HermesCorePublicWebCanary/1.0';

  async function execute(input = {}) {
    if (input.protocol !== 'https' || input.port !== 443) throw new Error('PUBLIC_WEB_HTTPS_ONLY');
    if (input.redirect_mode !== 'manual' || input.follow_redirects === true) throw new Error('PUBLIC_WEB_REDIRECT_MODE_INVALID');
    if (!input.approved_ip || !Array.isArray(input.approved_ips) || !input.approved_ips.includes(input.approved_ip)) throw new Error('PUBLIC_WEB_APPROVED_IP_REQUIRED');
    if (input.method && !['GET', 'HEAD'].includes(input.method)) throw new Error('PUBLIC_WEB_METHOD_BLOCKED');
    if (input.body || input.request_body || input.requestBody) throw new Error('PUBLIC_WEB_REQUEST_BODY_BLOCKED');

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
        if (Number.isInteger(contentLength) && contentLength > (input.max_response_bytes || REQUEST_LIMITS.default_response_bytes)) {
          req.destroy();
          reject(new Error('PUBLIC_WEB_RESPONSE_TOO_LARGE'));
          return;
        }
        const stream = new PassThrough();
        res.on('data', (chunk) => stream.write(chunk));
        res.on('end', () => stream.end());
        res.on('error', (error) => stream.destroy(error));
        const remoteAddress = res.socket && res.socket.remoteAddress || '';
        if (remoteAddress && remoteAddress !== input.approved_ip) {
          req.destroy();
          reject(new Error('PUBLIC_WEB_DNS_REBINDING_BLOCKED'));
          return;
        }
        resolve({
          status_code: res.statusCode,
          content_type: contentType,
          content_length: Number.isInteger(contentLength) ? contentLength : undefined,
          remote_address: remoteAddress || input.approved_ip,
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
