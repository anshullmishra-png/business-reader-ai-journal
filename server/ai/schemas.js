// zod schemas for AI outputs. Each is also sent to Claude Code as --json-schema.
import { z } from 'zod';
import { SECTORS, COMPANY_STAGES } from './taxonomy.js';

const short = (max) => z.string().trim().min(1).max(max);

export const Tags = z.object({
  companies: z.array(short(60)).max(8).describe('Companies named or central to the article, most important first'),
  sector: z.enum(SECTORS).describe('The single best-fitting sector'),
  business_model: short(60).describe('e.g. "Marketplace, take rate on GMV", "Subscription SaaS", "Inventory-led D2C"'),
  company_stage: z.enum(COMPANY_STAGES),
  geography: short(40).describe('Main market, e.g. "India", "India + SE Asia", "Global"'),
  themes: z.array(short(40)).min(3).max(5).describe('3-5 short business themes, e.g. "Unit economics", "Regulatory risk"'),
});

// What the user may save when editing tags by hand (they can remove themes).
export const TagsEdit = Tags.extend({
  themes: z.array(short(40)).max(5),
  business_model: z.string().trim().max(60),
  geography: z.string().trim().max(40),
});
