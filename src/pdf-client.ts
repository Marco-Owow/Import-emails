import { Agent } from '@mastra/core/agent';
import { getPdfTools } from './mastra/tools/pdf-tools';
import type { AiMessageType } from '@mastra/core/agent';
import * as readline from 'readline';

// Sample PDF for testing
const SAMPLE_PDF_URL =
  'https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table-word.pdf';

async function runDemo() {
  console.log('\n========================================');
  console.log('PDF.co Tools Demo (via Composio MCP)');
  console.log('========================================\n');

  // Load PDF.co tools from Composio
  console.log('Loading PDF.co tools via Composio MCP...');
  const pdfTools = await getPdfTools();

  const toolNames = Object.keys(pdfTools);
  console.log(`Loaded ${toolNames.length} PDF.co tools:`);
  for (const name of toolNames.slice(0, 10)) {
    console.log(`  - ${name}`);
  }
  if (toolNames.length > 10) {
    console.log(`  ... and ${toolNames.length - 10} more`);
  }

  // Create the agent with PDF tools loaded at runtime
  const agent = new Agent({
    name: 'pdf-agent',
    instructions: `You are a PDF processing assistant with access to PDF.co tools.
You can extract text, convert PDFs to other formats, merge, split, and more.
When given a PDF URL, use the appropriate tool to process it.
Present results clearly and concisely.`,
    model: process.env.MODEL || 'openai/gpt-4o',
  });

  // Demo: extract text from a sample PDF
  console.log(`\nExtracting text from sample PDF: ${SAMPLE_PDF_URL}\n`);

  const response = await agent.generate(
    [
      {
        role: 'user',
        content: `Extract the text content from this PDF: ${SAMPLE_PDF_URL}`,
      },
    ],
    {
      toolsets: { pdf_co: pdfTools },
      maxSteps: 8,
    },
  );

  console.log('Agent response:');
  console.log(response.text);

  return response;
}

async function runInteractive() {
  console.log('\n========================================');
  console.log('PDF.co Interactive Chat');
  console.log('========================================\n');

  console.log('Loading PDF.co tools via Composio MCP...');
  const pdfTools = await getPdfTools();
  console.log(`Loaded ${Object.keys(pdfTools).length} tools.\n`);

  const agent = new Agent({
    name: 'pdf-agent',
    instructions: `You are a PDF processing assistant with access to PDF.co tools.
You can extract text, convert PDFs to other formats, merge, split, OCR scanned documents, and more.
Use the appropriate tool for each request. Present results clearly.`,
    model: process.env.MODEL || 'openai/gpt-4o',
  });

  const messages: AiMessageType[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nYou> ',
  });

  console.log('Type your request (e.g., "Extract text from <pdf-url>")');
  console.log('Type "exit" to quit.\n');
  rl.prompt();

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();

    if (['exit', 'quit'].includes(trimmed.toLowerCase())) {
      console.log('Goodbye!');
      rl.close();
      process.exit(0);
    }

    if (!trimmed) {
      rl.prompt();
      return;
    }

    messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    });

    try {
      console.log('\nProcessing...\n');
      const response = await agent.generate(messages, {
        toolsets: { pdf_co: pdfTools },
        maxSteps: 8,
      });

      if (response.text?.trim()) {
        console.log(`Agent: ${response.text}`);
        messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.text,
        });
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
    }

    rl.prompt();
  });
}

// Parse CLI args: --interactive for chat mode, default runs the demo
const isInteractive = process.argv.includes('--interactive');

if (isInteractive) {
  runInteractive().catch(console.error);
} else {
  runDemo().catch((error) => {
    console.error('\nError:', error instanceof Error ? error.message : error);
    console.error('\nMake sure COMPOSIO_API_KEY and COMPOSIO_USER_ID are set in your .env');
    process.exit(1);
  });
}
