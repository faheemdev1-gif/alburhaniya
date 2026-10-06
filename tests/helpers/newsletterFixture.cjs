// Isolated database/SMTP fixture. Exercises the actual HTTP routes without external side effects.
function newsletterFixture(Model, nodemailer) {
  const rows = new Map(), mail = [], transportOptions = [];
  const state = { failStore: false, failMail: false, holdMail: null, collision: false };
  const originals = {};
  function match(row, query) {
    return Object.entries(query).every(([key, value]) => {
      if (key === '$or') return value.some(q => match(row, q));
      const field = row[key];
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.entries(value).every(([op, target]) => {
          if (op === '$exists') return (field !== undefined) === target;
          if (op === '$ne') return field !== target;
          if (op === '$in') return target.includes(field);
          if (op === '$lt') return field !== undefined && field < target;
          if (op === '$gt') return field !== undefined && field > target;
          if (op === '$regex') return new RegExp(target).test(field);
          throw Error('Unsupported fixture query: ' + op);
        });
      }
      return field === value;
    });
  }
  function apply(row, update) {
    Object.assign(row, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete row[key];
    return row;
  }
  function seed(data) {
    const id = (rows.size + 1).toString(16).padStart(24, '0');
    const row = { _id: id, id, status: 'pending', notificationStatus: 'pending', createdAt: new Date(), requestedAt: new Date(), ...data };
    rows.set(id, row); return row;
  }
  function safe(row, select = '') {
    if (!row) return null;
    const { id, confirmationHash, confirmationExpiresAt, ...publicFields } = row;
    if (select === 'email confirmedAt') return { _id: row._id, email: row.email, confirmedAt: row.confirmedAt };
    return publicFields;
  }
  function query(value) {
    let select = '';
    const q = { select: x => { select = x; return q; }, lean: async () => safe(value, select), then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
    return q;
  }
  const operations = {
    async findOneAndUpdate(filter, update, options) {
      if (state.failStore) throw Error('private-database-details');
      let row = [...rows.values()].find(r => match(r, filter));
      if (!row && options?.upsert) {
        row = seed(update.$setOnInsert);
        if (state.collision) { state.collision = false; throw { code: 11000 }; }
      }
      return row ? apply(row, update) : null;
    },
    async findOne(filter) { return [...rows.values()].find(r => match(r, filter)) || null; },
    findById(id) { return query(rows.get(id) || null); },
    async updateOne(filter, update) {
      if (state.failStore) throw Error('private-database-details');
      const row = [...rows.values()].find(r => match(r, filter));
      if (row) apply(row, update); return { modifiedCount: row ? 1 : 0 };
    },
    findByIdAndUpdate(id, update) { const row = rows.get(id); return query(row ? apply(row, update) : null); },
    async exists(filter) { return [...rows.values()].some(r => match(r, filter)); },
    find(filter) {
      let start = 0, count = Infinity, select = '';
      const q = { sort: () => q, skip: n => { start = n; return q; }, limit: n => { count = n; return q; }, select: x => { select = x; return q; },
        lean: async () => { if (state.failStore) throw Error('private-database-details'); return [...rows.values()].filter(r => match(r, filter)).reverse().slice(start, start + count).map(r => safe(r, select)); } };
      return q;
    },
    async countDocuments(filter) { return [...rows.values()].filter(r => match(r, filter)).length; },
  };
  for (const [key, value] of Object.entries(operations)) { originals[key] = Model[key]; Model[key] = value; }
  const transport = nodemailer.createTransport;
  nodemailer.createTransport = options => {
    transportOptions.push(options);
    return { close() {}, async sendMail(data) { mail.push(data); if (state.holdMail) await state.holdMail; if (state.failMail) throw Error('private-smtp-password'); return { accepted: [data.to] }; } };
  };
  return { rows, mail, state, seed, transportOptions, restore() { for (const [k, v] of Object.entries(originals)) Model[k] = v; nodemailer.createTransport = transport; } };
}
module.exports = { newsletterFixture };
