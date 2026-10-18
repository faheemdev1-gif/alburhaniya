// Existing route suites isolate MongoDB. These are actual persisted-account
// responses for the authentication lookup, rather than trusting a JWT's role.
const User = require('../../dist/models/User').default;
const accounts = new Map([
  ['aaaaaaaaaaaaaaaaaaaaaaaa', { role: 'admin', authVersion: 0 }],
  ['bbbbbbbbbbbbbbbbbbbbbbbb', { role: 'editor', authVersion: 0 }],
]);
const original = User.findById;
User.findById = id => {
  const q = { select: () => q, lean: async () => accounts.get(id) || null };
  return q;
};
module.exports = { accounts, restore() { User.findById = original; } };
