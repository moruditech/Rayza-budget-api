const { z } = require('zod');
const { LINE_ITEM_TYPES } = require('@budget-app/shared');

const createLineItemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  type: z.enum(Object.values(LINE_ITEM_TYPES)),
  allocatedAmount: z.number({ invalid_type_error: 'allocatedAmount must be a number' }).min(0),
  isRecurring: z.boolean().optional(),
  order: z.number().int().optional(),
  // Present only for SINKING_FUND — whether they're required/forbidden for
  // a given type is checked in lineItems.service.js, not here, so the
  // correct SINKING_FUND_FIELDS / INVALID_FIELDS_FOR_TYPE code is used.
  targetAmount: z.number().min(0).optional(),
  monthlyContribution: z.number().min(0).optional(),
});

// `type` is not updatable — switching an item between INSTANT_SPEND and
// SINKING_FUND after the fact isn't in the API Contract's PATCH example.
const updateLineItemSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100).optional(),
    allocatedAmount: z.number().min(0).optional(),
    isRecurring: z.boolean().optional(),
    order: z.number().int().optional(),
    targetAmount: z.number().min(0).optional(),
    monthlyContribution: z.number().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

const markUsedSchema = z.object({
  amount: z.number({ invalid_type_error: 'amount must be a number' }).positive(),
  note: z.string().trim().max(300).optional(),
});

module.exports = { createLineItemSchema, updateLineItemSchema, markUsedSchema };
