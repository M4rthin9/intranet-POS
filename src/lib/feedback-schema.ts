import { z } from 'zod';

export const feedbackCategories = {
  SUGGESTION: 'ข้อเสนอแนะ',
  COMPLIMENT: 'คำชม',
  ISSUE: 'แจ้งปัญหา',
} as const;
export const feedbackInputSchema = z.object({
  key: z.string().uuid(),
  eventId: z.string().uuid().nullable().default(null),
  rating: z.number().int().min(1).max(5),
  serviceRating: z.number().int().min(1).max(5).nullable().default(null),
  speedRating: z.number().int().min(1).max(5).nullable().default(null),
  category: z.enum(['SUGGESTION', 'COMPLIMENT', 'ISSUE']).default('SUGGESTION'),
  message: z.string().trim().max(2000).default(''),
  customerName: z.string().trim().max(120).default(''),
  contact: z.string().trim().max(200).default(''),
  website: z.string().max(0).default(''),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export function isFeedbackInput(value: unknown): value is FeedbackInput {
  return feedbackInputSchema.safeParse(value).success;
}
