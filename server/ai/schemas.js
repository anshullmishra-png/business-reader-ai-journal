// zod schemas for AI outputs. Each is also sent to Claude Code as --json-schema.
import { z } from 'zod';
import { SECTORS, COMPANY_STAGES, QUESTION_TYPES, FRAMEWORKS } from './taxonomy.js';

const short = (max) => z.string().trim().min(1).max(max);

export const Tags = z.object({
  companies: z.array(short(60)).max(8).describe('Companies named or central to the article, most important first'),
  sector: z.enum(SECTORS).describe('The single best-fitting sector'),
  business_model: short(60).describe('e.g. "Marketplace, take rate on GMV", "Subscription SaaS", "Inventory-led D2C"'),
  company_stage: z.enum(COMPANY_STAGES),
  geography: short(40).describe('Main market, e.g. "India", "India + SE Asia", "Global"'),
  themes: z.array(short(40)).min(3).max(5).describe('3-5 short business themes, e.g. "Unit economics", "Regulatory risk"'),
});

// ---------- Interview questions ----------
export const Question = z.object({
  type: z.enum(QUESTION_TYPES),
  framework: z.enum(FRAMEWORKS),
  prompt: short(700).describe('The question as the interviewer would ask it. Never contains the answer.'),
  options: z.array(short(200)).length(4).nullable().describe('MCQ only: exactly 4 options. null for other types.'),
  correct_option: z.number().int().min(0).max(3).nullable().describe('MCQ only: 0-based index of the correct option. null otherwise.'),
  explanation: z.string().trim().max(500).nullable().describe('MCQ only: one or two sentences on why the correct option is right. null otherwise.'),
  cross_article: z.boolean().describe('true if the question connects this article to an earlier one from the history'),
});

export const QuestionSet = z.object({ questions: z.array(Question).length(10) })
  .superRefine(({ questions }, ctx) => {
    questions.forEach((q, i) => {
      const isMcq = q.type === 'mcq';
      if (isMcq && (!q.options || q.correct_option == null || !q.explanation)) {
        ctx.addIssue({ code: 'custom', path: ['questions', i], message: 'MCQ needs 4 options, correct_option and explanation' });
      }
      if (!isMcq && (q.options || q.correct_option != null)) {
        ctx.addIssue({ code: 'custom', path: ['questions', i], message: 'Only MCQs have options and correct_option; use null' });
      }
    });
    for (const type of QUESTION_TYPES) {
      if (questions.filter((q) => q.type === type).length < 2) {
        ctx.addIssue({ code: 'custom', path: ['questions'], message: `Need at least 2 questions of type "${type}"` });
      }
    }
  });

// What the user may save when editing tags by hand (they can remove themes).
export const TagsEdit = Tags.extend({
  themes: z.array(short(40)).max(5),
  business_model: z.string().trim().max(60),
  geography: z.string().trim().max(40),
});
