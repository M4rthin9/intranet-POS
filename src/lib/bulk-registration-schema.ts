import { z } from 'zod';

export const bulkRegistrationSchema = z.object({
  eventId: z.string().uuid(),
  stationId: z.string().uuid(),
  key: z.string().uuid(),
  isVip: z.boolean().default(false),
  names: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  group: z.string().trim().max(80).default(''),
  tableNumber: z.string().trim().max(30).default(''),
});
export type BulkRegistration = z.infer<typeof bulkRegistrationSchema>;
export const isBulkRegistration = (value: unknown): value is BulkRegistration =>
  bulkRegistrationSchema.safeParse(value).success;
