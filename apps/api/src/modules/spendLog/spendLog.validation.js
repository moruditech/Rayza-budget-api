const { z } = require('zod');
const { PAYMENT_METHODS, SPEND_LOG_TYPES } = require('@budget-app/shared');

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

const spendLogQuerySchema = z.object({
  monthId: objectIdSchema.optional(),
  potId: objectIdSchema.optional(),
  lineItemId: objectIdSchema.optional(),
  type: z.enum(Object.values(SPEND_LOG_TYPES)).optional(),
  paymentMethod: z.enum(Object.values(PAYMENT_METHODS)).optional(),
  // Matches the note, the line item name or the pot name.
  search: z.string().trim().max(100).optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

module.exports = { spendLogQuerySchema };
