'use strict';

const { safeTransportResult } = require('./transcription-transport-contract');

function buildTranscriptionTransportMetadata(overrides = {}) {
  return safeTransportResult({
    metadata_status: 'transport_metadata_review_only',
    transport_family: 'transcription_future_transport',
    supported_transport_types: ['grpc_future', 'http_future', 'websocket_future'],
    network: false,
    connected: false,
    transport_simulated: true,
    runtime_registration: false,
    provider_execution: false,
    ...overrides
  });
}

module.exports = {
  buildTranscriptionTransportMetadata
};
