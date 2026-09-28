const SPEND_LOG_TYPES = {
  INSTANT_SPEND: 'INSTANT_SPEND',
  SINKING_FUND_USED: 'SINKING_FUND_USED',
  // Fund-to-fund transfers write one OUT and one IN entry sharing a transferId.
  // They move money between funds and are NOT counted as spending in reports.
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
};

module.exports = { SPEND_LOG_TYPES };
