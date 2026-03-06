import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { lookupByEmail, lookupByName } from './load-customer-master-tool';
import { extractionAgent } from '../agents/extraction-agent';

const segmentSchema = z.object({
  type: z.enum(['plain', 'quote', 'forward_header', 'signature', 'greeting']),
  content: z.string(),
  from: z.string().optional(),
  date: z.string().optional(),
});

export const resolveSenderTool = createTool({
  id: 'resolve-sender-tool',
  description: 'Resolves the customer Sold-To code by matching the email sender against the customer master data Excel',
  inputSchema: z.object({
    senderType: z.enum(['opple', 'external']),
    fromEmail: z.string(),
    originalCustomerName: z.string().optional().describe('Extracted customer name (for opple path)'),
    emailBodyExcerpt: z.string().describe('First ~1500 chars of email body for LLM fallback'),
    segments: z.array(segmentSchema).describe('Parsed email segments from evidence pack'),
  }),
  outputSchema: z.object({
    soldToCode: z.string().optional(),
    company: z.string().optional(),
    country: z.string().optional(),
    confirmationEmail: z.string().optional(),
    deliveryDay: z.string().optional(),
    combiningDay: z.string().optional(),
    isResolved: z.boolean(),
    matchMethod: z.enum(['email_exact', 'name_fuzzy', 'llm_name_fuzzy', 'unresolved']),
    matchConfidence: z.number(),
  }),
  execute: async (inputData) => {
    const { senderType, fromEmail, originalCustomerName, emailBodyExcerpt, segments } = inputData;

    // --- OPPLE PATH ---
    if (senderType === 'opple') {
      // First: use the extracted customer name if available
      if (originalCustomerName) {
        const result = lookupByName(originalCustomerName);
        if (result) {
          console.log(`[resolve-sender] Opple path: fuzzy name match "${originalCustomerName}" → "${result.record.company}" (score: ${result.score.toFixed(2)})`);
          return {
            ...result.record,
            isResolved: true,
            matchMethod: 'name_fuzzy' as const,
            matchConfidence: result.score,
          };
        }
      }

      // Fallback: LLM extracts customer name from body
      const extractedName = await extractCustomerNameViaLLM(emailBodyExcerpt, segments);
      if (extractedName) {
        const result = lookupByName(extractedName);
        if (result) {
          console.log(`[resolve-sender] Opple path: LLM+fuzzy match "${extractedName}" → "${result.record.company}" (score: ${result.score.toFixed(2)})`);
          return {
            ...result.record,
            isResolved: true,
            matchMethod: 'llm_name_fuzzy' as const,
            matchConfidence: result.score,
          };
        }
      }

      console.log(`[resolve-sender] Opple path: no match found for "${originalCustomerName ?? 'unknown'}"`);
      return unresolved();
    }

    // --- EXTERNAL PATH ---

    // Step 1: exact match by confirmation email
    const byEmailMatch = lookupByEmail(fromEmail);
    if (byEmailMatch) {
      console.log(`[resolve-sender] External path: email exact match "${fromEmail}" → "${byEmailMatch.company}"`);
      return {
        ...byEmailMatch,
        isResolved: true,
        matchMethod: 'email_exact' as const,
        matchConfidence: 1.0,
      };
    }

    // Step 2: LLM extracts company name from body → fuzzy match
    const extractedName = await extractCustomerNameViaLLM(emailBodyExcerpt, segments);
    if (extractedName) {
      const result = lookupByName(extractedName);
      if (result) {
        console.log(`[resolve-sender] External path: LLM+fuzzy match "${extractedName}" → "${result.record.company}" (score: ${result.score.toFixed(2)})`);
        return {
          ...result.record,
          isResolved: true,
          matchMethod: 'llm_name_fuzzy' as const,
          matchConfidence: result.score,
        };
      }
    }

    console.log(`[resolve-sender] External path: no match found for "${fromEmail}"`);
    return unresolved();
  },
});

function unresolved() {
  return {
    soldToCode: undefined,
    company: undefined,
    country: undefined,
    confirmationEmail: undefined,
    deliveryDay: undefined,
    combiningDay: undefined,
    isResolved: false,
    matchMethod: 'unresolved' as const,
    matchConfidence: 0,
  };
}

async function extractCustomerNameViaLLM(
  bodyExcerpt: string,
  segments: Array<{ type: string; content: string; from?: string }>,
): Promise<string | null> {
  // First, check forward_header segments — they often have the original sender's name
  for (const seg of segments) {
    if (seg.type === 'forward_header' && seg.from) {
      // Extract name part from "Name <email@example.com>" or just return the raw from
      const nameMatch = seg.from.match(/^([^<]+)</);
      if (nameMatch) return nameMatch[1].trim();
      return seg.from.trim();
    }
  }

  // LLM fallback: ask the extraction agent to identify the company name
  const prompt = `From the following email content, extract ONLY the company or customer name of the sender or the company placing the order. Return ONLY the company name as plain text, nothing else. If you cannot determine it, return "UNKNOWN".

Email content:
${bodyExcerpt.slice(0, 1500)}`;

  try {
    const response = await extractionAgent.generate(prompt);
    const name = response.text?.trim();
    if (!name || name === 'UNKNOWN' || name.length < 2) return null;
    return name;
  } catch (error) {
    console.error('[resolve-sender] LLM name extraction failed:', error);
    return null;
  }
}
