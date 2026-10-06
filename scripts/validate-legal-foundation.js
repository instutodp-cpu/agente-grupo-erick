const fs = require('node:fs');
const path = require('node:path');

const required = [
  'legal/SKILL.md',
  'legal/CAPABILITY_MAP.md',
  'legal/contracts/legal-effect.schema.json',
  'legal/contracts/legal-source.schema.json',
  'legal/contracts/legal-claim.schema.json',
  'legal/contracts/legal-evidence-bundle.schema.json',
  'legal/contracts/legal-source-snapshot.schema.json',
  'legal/contracts/legal-authority.schema.json',
  'legal/contracts/legal-evidence.schema.json',
  'legal/contracts/legal-retrieval-query.schema.json',
  'legal/contracts/legal-document.schema.json',
  'legal/contracts/legal-document-version.schema.json',
  'legal/contracts/legal-document-fragment.schema.json',
  'legal/contracts/legal-contract.schema.json',
  'legal/contracts/legal-clause.schema.json',
  'legal/contracts/legal-obligation.schema.json'
];

for (const file of required) {
  if (!fs.existsSync(path.join(process.cwd(), file))) throw new Error('missing legal foundation artifact: ' + file);
}
for (const file of required.filter((f) => f.endsWith('.json'))) {
  const parsed = JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
  if (parsed.additionalProperties !== false) throw new Error('schema must fail closed: ' + file);
}
console.log('legal foundation artifacts valid');
