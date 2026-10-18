const bcrypt = require('bcryptjs');

function passwordResetFixture(User, nodemailer) {
  const rows = new Map(), mail = [];
  const state = { failStore: false, failMail: false, rejectMail: false, holdMail: null };
  const originals = {};
  const hidden = ['password', 'authVersion', 'passwordResetTokenHash', 'passwordResetExpiresAt', 'passwordResetRequestedAt'];
  function match(row, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (key === '$or') return value.some(f => match(row, f));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.entries(value).every(([op, target]) => {
          if (op === '$exists') return (row[key] !== undefined) === target;
          if (op === '$lt') return row[key] !== undefined && row[key] < target;
          if (op === '$gt') return row[key] !== undefined && row[key] > target;
          throw Error('Unsupported fixture operator ' + op);
        });
      }
      return String(row[key]) === String(value);
    });
  }
  function project(row, selection = '', lean = false) {
    if (!row) return null;
    const selected = selection.split(/\s+/).filter(Boolean);
    const included = selected.filter(k => !/^[+-]/.test(k));
    const copy = included.length ? Object.fromEntries(['_id', ...included, ...selected.filter(k => k[0] === '+').map(k => k.slice(1))].map(k => [k, row[k]])) : { ...row };
    for (const key of hidden) if (!selected.includes('+' + key) && !included.includes(key)) delete copy[key];
    for (const key of selected.filter(k => k[0] === '-')) delete copy[key.slice(1)];
    if (!lean) copy.comparePassword = candidate => bcrypt.compare(candidate, copy.password);
    return copy;
  }
  function query(run) {
    let selection = '', lean = false;
    const q = {
      select(value) { selection = value; return q; },
      lean() { lean = true; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => { if (state.failStore) throw Error('secret database credentials'); return run(); }).then(row => project(row, selection, lean)).then(resolve, reject); },
    };
    return q;
  }
  function seed(data = {}) {
    const id = String(rows.size + 1).padStart(24, '0');
    const row = { _id: id, name: 'Admin', email: 'admin@example.test', role: 'admin', authVersion: 0, ...data, password: bcrypt.hashSync(data.password || 'Old-password-123', 4) };
    rows.set(id, row); return row;
  }
  for (const key of ['findOne', 'findById', 'findOneAndUpdate', 'exists', 'updateOne']) originals[key] = User[key];
  User.findOne = filter => query(() => [...rows.values()].find(row => match(row, filter)));
  User.findById = id => query(() => rows.get(String(id)));
  function update(filter, change) {
    const row = [...rows.values()].find(row => match(row, filter));
    if (!row) return null;
    Object.assign(row, change.$set || {});
    for (const [key, value] of Object.entries(change.$inc || {})) row[key] = (row[key] || 0) + value;
    for (const key of Object.keys(change.$unset || {})) delete row[key];
    return row;
  }
  User.findOneAndUpdate = (filter, change) => query(() => update(filter, change));
  User.exists = async filter => { if (state.failStore) throw Error('secret database credentials'); return [...rows.values()].some(row => match(row, filter)); };
  User.updateOne = async (filter, change) => update(filter, change);
  const transport = nodemailer.createTransport;
  nodemailer.createTransport = options => ({ close() {}, async sendMail(data) {
    if (options.host !== 'smtp.example.test') throw Error('Refusing external SMTP in tests');
    mail.push(data);
    if (state.holdMail) await state.holdMail;
    if (state.failMail) throw Error('secret SMTP credentials');
    return { accepted: state.rejectMail ? [] : [data.to] };
  } });
  return { rows, mail, state, seed, restore() { Object.assign(User, originals); nodemailer.createTransport = transport; } };
}
module.exports = { passwordResetFixture };
