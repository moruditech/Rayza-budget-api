const SpendLog = require('../../models/SpendLog.model');
const { getPaginationParams, buildPaginationMeta } = require('../../utils/paginate');

// FR-10 — every transaction and every sinking-fund Mark as Used event
// appears here automatically, since both write to the same SpendLog
// collection (see transactions.service.js and sinkingFund.service.js).
async function listSpendLog(userId, query) {
  const { page, limit, skip } = getPaginationParams(query);

  const filter = { userId };
  if (query.monthId) filter.monthId = query.monthId;
  if (query.potId) filter.potId = query.potId;
  if (query.lineItemId) filter.lineItemId = query.lineItemId;
  if (query.type) filter.type = query.type;
  if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = query.from;
    if (query.to) filter.date.$lte = query.to;
  }

  const [entries, total] = await Promise.all([
    SpendLog.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .populate('potId', 'name')
      .populate('lineItemId', 'name')
      .lean(),
    SpendLog.countDocuments(filter),
  ]);

  const data = entries.map((entry) => ({
    _id: entry._id,
    type: entry.type,
    amount: entry.amount,
    date: entry.date,
    note: entry.note,
    paymentMethod: entry.paymentMethod,
    pot: entry.potId ? { _id: entry.potId._id, name: entry.potId.name } : null,
    lineItem: entry.lineItemId
      ? { _id: entry.lineItemId._id, name: entry.lineItemId.name }
      : null,
  }));

  return { data, meta: buildPaginationMeta(page, limit, total) };
}

module.exports = { listSpendLog };
