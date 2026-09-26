const { z } = require('zod');
const { POT_TYPES } = require('@budget-app/shared');

const createPotSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(50),
  type: z.enum(Object.values(POT_TYPES)),
  budgetLimit: z.number({ invalid_type_error: 'budgetLimit must be a number' }).min(0),
  icon: z.string().trim().optional(),
  colour: z.string().trim().optional(),
  order: z.number().int().optional(),
});

// `type` is intentionally not updatable — the API Contract's PATCH example
// only shows name/budgetLimit/colour/order, and changing a pot's behaviour
// after it has line items would be a much bigger operation than a field edit.
const updatePotSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(50).optional(),
    budgetLimit: z.number().min(0).optional(),
    icon: z.string().trim().optional(),
    colour: z.string().trim().optional(),
    order: z.number().int().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

const deletePotSchema = z.object({
  force: z.boolean().optional(),
});

module.exports = { createPotSchema, updatePotSchema, deletePotSchema };
