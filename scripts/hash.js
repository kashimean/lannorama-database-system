// Generate the SHA-256 hash for your developer admin password.
// Usage: node scripts/hash.js "your password"
// Paste the printed hash into ADMIN_HASH in src/auth.js

const crypto = require('crypto');

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node scripts/hash.js "your password"');
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(pw).digest('hex');
console.log('Paste this into ADMIN_HASH in src/auth.js:');
console.log(hash);
