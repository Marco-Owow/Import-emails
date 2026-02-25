import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { query } from '../db/client';
import { emailSegmentSchema, type EmailSegment } from '../schemas';

/**
 * Segments an email body into structured parts:
 * - plain text content
 * - quoted reply blocks (> prefixed or Outlook-style)
 * - forwarded message headers
 * - signatures
 * - greetings
 */
function segmentEmailBody(body: string, bodyType: string): EmailSegment[] {
  // Strip HTML tags if body is HTML, preserving line breaks
  let text = body;
  if (bodyType === 'html') {
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  }

  const lines = text.split('\n');
  const segments: EmailSegment[] = [];
  let currentType: EmailSegment['type'] = 'plain';
  let currentLines: string[] = [];
  let forwardFrom: string | undefined;
  let forwardDate: string | undefined;

  function flushSegment() {
    const content = currentLines.join('\n').trim();
    if (content) {
      const segment: EmailSegment = { type: currentType, content };
      if (currentType === 'forward_header') {
        if (forwardFrom) segment.from = forwardFrom;
        if (forwardDate) segment.date = forwardDate;
      }
      segments.push(segment);
    }
    currentLines = [];
    forwardFrom = undefined;
    forwardDate = undefined;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect forwarded message block
    if (
      /^-{3,}\s*forwarded message\s*-{3,}/i.test(trimmed) ||
      /^begin forwarded message/i.test(trimmed) ||
      /^-{3,}\s*original message\s*-{3,}/i.test(trimmed)
    ) {
      flushSegment();
      currentType = 'forward_header';
      currentLines.push(line);

      // Look ahead for From: / Date: lines
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (/^from:/i.test(nextLine)) {
          forwardFrom = nextLine.replace(/^from:\s*/i, '').trim();
          currentLines.push(lines[j]);
          i = j;
        } else if (/^date:/i.test(nextLine)) {
          forwardDate = nextLine.replace(/^date:\s*/i, '').trim();
          currentLines.push(lines[j]);
          i = j;
        } else if (/^(to|subject|cc):/i.test(nextLine)) {
          currentLines.push(lines[j]);
          i = j;
        } else if (nextLine === '') {
          i = j;
          break;
        } else {
          break;
        }
      }
      flushSegment();
      currentType = 'plain';
      continue;
    }

    // Detect signature block
    if (
      /^--\s*$/.test(trimmed) ||
      /^_{3,}$/.test(trimmed) ||
      /^(regards|best regards|kind regards|thanks|cheers|sincerely|sent from my)/i.test(trimmed)
    ) {
      flushSegment();
      currentType = 'signature';
      // Collect remaining lines as signature
      for (let j = i; j < lines.length; j++) {
        currentLines.push(lines[j]);
      }
      flushSegment();
      break;
    }

    // Detect quoted lines (> prefix)
    if (/^>/.test(trimmed)) {
      if (currentType !== 'quote') {
        flushSegment();
        currentType = 'quote';
      }
      currentLines.push(line.replace(/^>\s?/, ''));
      continue;
    }

    // Detect greeting (only at the very start)
    if (
      segments.length === 0 &&
      currentLines.length === 0 &&
      /^(hi|hello|hey|dear|good morning|good afternoon|good evening)\b/i.test(trimmed)
    ) {
      flushSegment();
      currentType = 'greeting';
      currentLines.push(line);
      flushSegment();
      currentType = 'plain';
      continue;
    }

    // Default: plain text
    if (currentType !== 'plain') {
      flushSegment();
      currentType = 'plain';
    }
    currentLines.push(line);
  }

  flushSegment();
  return segments;
}

export const parseEmailBodyTool = createTool({
  id: 'parse-email-body-tool',
  description: 'Segments an email body into structured parts: plain text, quotes, forwards, signatures',
  inputSchema: z.object({
    messageId: z.string().uuid().describe('ID of the message to parse'),
  }),
  outputSchema: z.object({
    segments: z.array(emailSegmentSchema),
    segmentCount: z.number(),
  }),
  execute: async (inputData) => {
    const { messageId } = inputData;

    // Load message from DB
    const result = await query(
      'SELECT body, body_type FROM messages WHERE id = $1',
      [messageId],
    );

    if (result.rows.length === 0) {
      throw new Error(`Message not found: ${messageId}`);
    }

    const { body, body_type } = result.rows[0];
    const segments = segmentEmailBody(body, body_type);

    console.log(`Parsed email ${messageId}: ${segments.length} segments (${segments.map(s => s.type).join(', ')})`);

    return { segments, segmentCount: segments.length };
  },
});
