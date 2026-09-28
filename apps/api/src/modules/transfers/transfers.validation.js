const { z } = require('zod');

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

const createTransferSchema = z.object({
  fromLineItemId: objectIdSchema,
  toLineItemId: objectIdSchema,
  amount: z.number({ invalid_type_error: 'amount must be a number' }).positive(),
  note: z.string().trim().max(300).optional(),
});

module.exports = { createTransferSchema };
