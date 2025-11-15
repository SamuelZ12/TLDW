import { z } from 'zod';

const timestampPattern = /^(?:\d{1,2}:)?\d{1,2}:\d{1,2}$/;

export const topicQuoteSchema = z.object({
  timestamp: z.string(),
  text: z.string()
});

export const topicGenerationSchema = z.array(
  z.object({
    title: z.string(),
    quote: topicQuoteSchema.optional()
  })
);

export const suggestedQuestionsSchema = z.array(z.string());

export const chatResponseSchema = z.object({
  answer: z.string(),
  timestamps: z.array(z.string().regex(timestampPattern)).max(5).optional()
});

export const summaryTakeawaySchema = z.object({
  label: z.string().min(1),
  insight: z.string().min(1),
  timestamps: z.array(z.string().regex(timestampPattern)).min(1).max(2)
});

export const summaryTakeawaysSchema = z.array(summaryTakeawaySchema).min(4).max(6);

export const quickPreviewSchema = z.object({
  overview: z.string().min(1)
});

export const topQuoteSchema = z.object({
  title: z.string().min(1),
  quote: z.string().min(1),
  timestamp: z.string().regex(timestampPattern)
});

export const topQuotesSchema = z.array(topQuoteSchema).min(1).max(5);
