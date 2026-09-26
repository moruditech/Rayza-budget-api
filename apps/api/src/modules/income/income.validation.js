const { z } = require('zod');

const createIncomeSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(100),
  amount: z.number({ invalid_type_error: 'amount must be a number' }).min(0),
});

const updateIncomeSchema = z
  .object({
    label: z.string().trim().min(1, 'Label is required').max(100).optional(),
    amount: z.number().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

module.exports = { createIncomeSchema, updateIncomeSchema };
