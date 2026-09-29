const SPEND_LOG_TYPES = {
  INSTANT_SPEND: 'INSTANT_SPEND',
  SINKING_FUND_USED: 'SINKING_FUND_USED',
  // Fund-to-fund transfers write one OUT and one IN entry sharing a transferId.
  // They move money between funds and are NOT counted as spending in reports.
  // One-off top-up of a fund from the pot's remaining budget. Money moves
  // from budget into the fund — not spending, so reports ignore it.
  SINKING_FUND_DEPOSIT: 'SINKING_FUND_DEPOSIT',
  // Interest the bank actually paid into a fund. New money in the fund — not
  // spending and not taken from the pot's budget.
  SINKING_FUND_INTEREST: 'SINKING_FUND_INTEREST',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
};

module.exports = { SPEND_LOG_TYPES };
