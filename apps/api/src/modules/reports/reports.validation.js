const { z } = require('zod');

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

const monthsQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).optional(),
});

const monthIdQuerySchema = z.object({
  monthId: objectIdSchema,
});

module.exports = { monthsQuerySchema, monthIdQuerySchema };
