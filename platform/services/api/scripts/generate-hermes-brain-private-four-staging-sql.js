#!/usr/bin/env node
'use strict';
// Generate ONE private staging SQL seed from the already-curated 0600 VPS file.
// No content is checked into Git or printed. NEVER executes SQL or writes memory_items.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = '/home/hermesadmin/.hermes-telegram/state';
const source = path.join(root, 'auto-memory.json');
const output = path.join(root, 'hermes-brain-four-attested-payload.sql');
const expected = [
  {
    kind: 'confirmed_decision', domain: 'financeiro',
    digest: 'af7f685362389986fde735a6892c89cc7ed74747fa9a7dd8d282db035d0d8571',
    content: 'baeb2f915220c8886160d588b3a66e6cf3ceda8a049031a51b97c0a0567f96ef',
    version: '2026-10-22T20:59:52.272Z', expiry: '2027-04-20T20:59:52.272Z'
  },
  {
    kind: 'verified_aggregate', domain: 'comercial',
    digest: 'd5d3e682b9f21b333e8cec48a3ba13f8ef8e69b813fe6b4a634a4a5fca7297b3',
    content: 'b898f96d7e1f401cf9adbb5d7567d9ecc89ef54b642944c90425c9f36df7f607',
    version: '2026-10-22T20:02:39.505Z', expiry: '2026-11-05T20:02:39.505Z'
  },
  {
    kind: 'verified_aggregate', domain: 'comercial',
    digest: 'f366fd68e4436704028a3f825d62be7d7157391aa0f049785d686c633cdc04b5',
    content: 'e27c06f7fc871c0ee8047f46b19fdd043b93f290ea85dd0e59c10fd1146a3ead',
    version: '2026-10-22T20:02:37.528Z', expiry: '2026-11-05T20:02:37.528Z'
  },
  {
    kind: 'verified_aggregate', domain: 'comercial',
    digest: '909fd5bb34fd00784c9ae7f49ae012ade26111d9e9bc17cbdc8b7040875b05ee',
    content: 'eb39275363f7a48406cb2315147b91e0390ed999c5181b23cc92c985aea87f35',
    version: '2026-10-22T19:19:15.514Z', expiry: '2026-11-05T19:19:15.514Z'
  }
];
const sha = str => crypto.createHash('sha256').update(str, 'utf8').digest('hex');
const srcStat = fs.statSync(source);
if ((srcStat.mode & 0o077) !== 0) throw Error('CURATOR_FILE_NOT_PRIVATE_0600');
const data = JSON.parse(fs.readFileSync(source, 'utf8'));
if (data.tenant_id !== 'grupo_erick' || !Array.isArray(data.items) ||
    data.items.length !== expected.length) throw Error('CURATOR_CONTRACT_MISMATCH');
const decisions = JSON.parse(fs.readFileSync(path.join(root, 'owner-decisions.json'), 'utf8'));
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'business-evidence-memory.json'), 'utf8'));
const rows = data.items.map((m, i) => {
  const e = expected[i];
  if (m.tenant_id !== 'grupo_erick' || m.kind !== e.kind ||
      m.domain !== e.domain || m.visibility !== 'owner_only' ||
      m.at !== e.version || m.expires_at !== e.expiry ||
      !m.text || m.text.length < 12 || m.text.length > 420 ||
      sha(m.text) !== e.content || Date.parse(m.expires_at) <= Date.now()) {
    throw Error('EVIDENCE_MISMATCH_' + i);
  }
  if (i === 0) {
    if (!decisions.entries.some(d => m.source === 'owner_confirmed_telegram:' + d.id))
      throw Error('OWNER_DECISION_NOT_CONFIRMED');
  } else if (!evidence.entries.some(d => m.source === d.source &&
      sha('grupo_erick:verified:' + d.key + ':' + m.at) === m.id)) {
    throw Error('COMMERCIAL_ORIGIN_UNVERIFIED_' + i);
  }
  // Base64 prevents text from becoming SQL syntax and keeps it off the CLI output.
  return `('sha256:${e.digest}','${e.version}','${e.expiry}'::timestamptz,
    'sha256:${e.content}','${Buffer.from(m.text, 'utf8').toString('base64')}')`;
});
const sql = `-- VERIFIED PRIVATE VPS EXPORT. Destination ONLY Hermes Brain staging.
-- DO NOT COMMIT / SHARE. Administrative seed of staging payload, NOT memory_items.
BEGIN;
DO $precheck$
BEGIN
 IF (SELECT count(*) FROM hermes_brain.memberships WHERE tenant_id='grupo_erick'
     AND status='active' AND 'financeiro'=ANY(allowed_domains)
     AND 'comercial'=ANY(allowed_domains))<>1
 OR (SELECT count(*) FROM hermes_brain.automemory_admissions
     WHERE tenant_id='grupo_erick' AND status='admitted' AND expires_at>now())<>4
 OR (SELECT count(*) FROM hermes_brain.sources WHERE tenant_id='grupo_erick'
     AND status='verified')<>2
 OR has_table_privilege('anon','hermes_brain.automemory_admissions','UPDATE')
 THEN RAISE EXCEPTION 'HERMES_BRAIN_PRIVATE_STAGING_PREFLIGHT_DENIED'; END IF;
END $precheck$;
WITH expected(item_digest,item_version,expiry,content_digest,encoded) AS (
 VALUES
${rows.join(',\n')}
)
UPDATE hermes_brain.automemory_admissions a
SET staged_content=pg_catalog.convert_from(pg_catalog.decode(e.encoded,'base64'),'UTF8')
FROM expected e
WHERE a.tenant_id='grupo_erick' AND a.status='admitted'
 AND a.source_item_digest=e.item_digest AND a.source_version=e.item_version
 AND a.expires_at=e.expiry AND a.content_digest=e.content_digest
 AND EXISTS (SELECT 1 FROM hermes_brain.sources s
  WHERE s.tenant_id=a.tenant_id AND s.source_id=a.source_id AND s.status='verified');
DO $verify$
BEGIN
 IF (SELECT count(*) FROM hermes_brain.automemory_admissions
     WHERE tenant_id='grupo_erick' AND status='admitted'
       AND staged_content IS NOT NULL AND expires_at>now())<>4
 OR (SELECT count(*) FROM hermes_brain.memory_items WHERE tenant_id='grupo_erick')<>0
 THEN RAISE EXCEPTION 'HERMES_BRAIN_STAGE_VERIFICATION_FAILED'; END IF;
END $verify$;
COMMIT;
SELECT count(*) AS staged_four
FROM hermes_brain.automemory_admissions
WHERE tenant_id='grupo_erick' AND staged_content IS NOT NULL;
`;
fs.writeFileSync(output, sql, {mode: 0o600, flag: 'wx'});
console.log('PRIVATE_STAGING_SQL_CREATED: ' + output);
console.log('ITEM_COUNT=4 SQL_SHA256=' + sha(sql));
