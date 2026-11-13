const crypto = require('node:crypto');

function sha256(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

function createSourceSnapshot({sourceId, content, retrievedAt, retrievalRunId, traceId, supersedesSnapshotId=null}) {
  if (!sourceId || content == null || !retrievedAt || !retrievalRunId || !traceId) {
    throw new Error('incomplete_source_snapshot');
  }
  const contentHash = sha256(content);
  return Object.freeze({
    snapshot_id: 'sha256:' + contentHash,
    source_id: sourceId,
    retrieved_at: retrievedAt,
    content_hash: contentHash,
    immutable: true,
    raw_evidence_preserved: true,
    supersedes_snapshot_id: supersedesSnapshotId,
    retrieval_run_id: retrievalRunId,
    trace_id: traceId
  });
}

module.exports = { sha256, createSourceSnapshot };
