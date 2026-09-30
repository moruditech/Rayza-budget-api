const { z } = require('zod');

const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required').max(128),
});

module.exports = { deleteAccountSchema };
