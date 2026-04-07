const crypto = require('crypto');

function getTableNameHash(sessionId) {
  const hash = crypto.createHash('md5').update(sessionId).digest('hex');
  return hash.toLowerCase();
}

console.log('gh_14a37955a574 ->', getTableNameHash('gh_14a37955a574'));
console.log('from log: hash=9ba5f26c75bbd080faeb5eb01d9134b2');
