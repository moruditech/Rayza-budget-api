const { z } = require('zod');

// Password policy isn't specified in the Scope & Requirements doc beyond
// "hashed with bcrypt before storage". Using a reasonable default — min 8
// characters, at least one letter and one number — flagged for review.
// max(128) is defense in depth: the global 10kb body limit already bounds
// this, but capping it explicitly keeps behavior predictable regardless.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().max(254).email('Must be a valid email address'),
  password: passwordSchema,
  // Must be ticked: accepts the Terms of Use and Privacy Policy and confirms
  // the person is 18 or older. The accepted version is recorded server-side.
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms of Use and Privacy Policy' }),
  }),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Must be a valid email address'),
  password: z.string().min(1, 'Password is required').max(128, 'Password must be at most 128 characters'),
});

const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, 'Current password is required')
    .max(128, 'Current password must be at most 128 characters'),
  newPassword: passwordSchema,
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Must be a valid email address'),
});

const resetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, 'Reset link is invalid'),
  password: passwordSchema,
});

// Accepting the current Terms / Privacy Policy (for people who registered
// before they existed, or after they changed).
const consentSchema = z.object({
  accept: z.literal(true, { errorMap: () => ({ message: 'You must accept to continue' }) }),
});

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  consentSchema,
};
