const { z } = require('zod');

const createMonthSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

const decisionSchema = z
  .object({
    potId: objectIdSchema,
    action: z.enum(['RESET', 'ROLLOVER', 'SWEEP']),
    targetPotId: objectIdSchema.optional(),
  })
  .refine((d) => d.action !== 'SWEEP' || !!d.targetPotId, {
    message: 'targetPotId is required when action is SWEEP',
    path: ['targetPotId'],
  });

const rolloverSchema = z.object({
  decisions: z.array(decisionSchema).min(1, 'At least one decision is required'),
});

module.exports = { createMonthSchema, rolloverSchema };
