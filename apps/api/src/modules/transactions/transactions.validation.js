const { z } = require('zod');
const { PAYMENT_METHODS } = require('@budget-app/shared');

const createTransactionSchema = z.object({
  amount: z.number({ invalid_type_error: 'amount must be a number' }).positive(),
  date: z.coerce.date(),
  note: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(Object.values(PAYMENT_METHODS)).optional(),
  // Idempotency key for spends logged offline (see SpendLog.model.js).
  clientRequestId: z.string().trim().min(8).max(64).optional(),
});

const updateTransactionSchema = z
  .object({
    amount: z.number().positive().optional(),
    date: z.coerce.date().optional(),
    note: z.string().trim().max(300).optional(),
    paymentMethod: z.enum(Object.values(PAYMENT_METHODS)).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

module.exports = { createTransactionSchema, updateTransactionSchema };
