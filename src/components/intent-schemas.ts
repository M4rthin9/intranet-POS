import { z } from 'zod';
const context = {
  eventId: z.string().uuid(),
  stationId: z.string().uuid(),
  token: z.string().min(10).max(100),
  key: z.string().uuid(),
};
export const orderIntentSchema = z.object({
  ...context,
  expectedTotalSatang: z.number().int().positive(),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
});
export const generateIntentSchema = z.object({
  ...context,
  method: z.enum(['PROMPTPAY', 'CASH']).optional(),
});
export const confirmIntentSchema = z.object({
  paymentId: z.string().uuid(),
  stationId: z.string().uuid(),
  key: z.string().uuid(),
  reference: z.string().min(3).max(120),
  evidence: z.string().min(3).max(1000),
  evidenceVerified: z.literal(true),
  cashReceivedSatang: z.number().int().nonnegative().max(2147483647).optional(),
  eventId: z.string().uuid().optional(),
  token: z.string().min(10).max(100).optional(),
});
export type OrderIntent = z.infer<typeof orderIntentSchema>;
export type GenerateIntent = z.infer<typeof generateIntentSchema>;
export type ConfirmIntent = z.infer<typeof confirmIntentSchema>;
export const isOrderIntent = (value: unknown): value is OrderIntent =>
  orderIntentSchema.safeParse(value).success;
export const isGenerateIntent = (value: unknown): value is GenerateIntent =>
  generateIntentSchema.safeParse(value).success;
export const isConfirmIntent = (value: unknown): value is ConfirmIntent =>
  confirmIntentSchema.safeParse(value).success;
