const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..', 'marketing', 'contracts'),
  path.join(__dirname, '..', 'marketing', 'evals', 'scenarios'),
  path.join(__dirname, '..', 'marketing', 'evals', 'adversarial'),
];

let checked = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(root, name);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Expected JSON object: ${file}`);
    }
    checked += 1;
  }
}
if (checked === 0) throw new Error('No marketing JSON artifacts found');
console.log(`marketing artifacts valid JSON: ${checked}`);
