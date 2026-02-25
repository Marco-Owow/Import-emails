import { MastraClient } from '@mastra/client-js';

const client = new MastraClient({
  baseUrl: 'http://localhost:4111',
});

// Sample CSV for testing (small public dataset)
const SAMPLE_CSV_URL =
  'https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv';

async function listAllTools() {
  console.log('\n========================================');
  console.log('1. Listing all available tools');
  console.log('========================================\n');

  const tools = await client.listTools();
  const toolIds = Object.keys(tools);
  console.log(`Found ${toolIds.length} tools:`);
  for (const id of toolIds) {
    console.log(`  - ${id}: ${tools[id]?.description ?? 'No description'}`);
  }
  return toolIds;
}

async function callDownloadCsvTool() {
  console.log('\n========================================');
  console.log('2. Calling download-csv-tool');
  console.log('========================================\n');

  const tool = client.getTool('download-csv-tool');
  console.log(`Input: { csvUrl: "${SAMPLE_CSV_URL}" }\n`);

  const result = await tool.execute({
    data: { csvUrl: SAMPLE_CSV_URL },
  });

  console.log('Result:');
  console.log(`  File size:    ${result.fileSize} bytes`);
  console.log(`  Rows:         ${result.rowCount}`);
  console.log(`  Columns:      ${result.columnCount}`);
  console.log(`  Characters:   ${result.characterCount}`);
  console.log(`  Summary:      ${result.summary.slice(0, 200)}...`);

  return result;
}

async function callGenerateQuestionsTool(summary: string) {
  console.log('\n========================================');
  console.log('3. Calling generate-questions-from-text-tool');
  console.log('========================================\n');

  const tool = client.getTool('generate-questions-from-text-tool');
  console.log(`Input: { extractedText: "<summary from step 2>", maxQuestions: 5 }\n`);

  const result = await tool.execute({
    data: { extractedText: summary, maxQuestions: 5 },
  });

  console.log('Result:');
  console.log(`  Success: ${result.success}`);
  console.log(`  Questions (${result.questionCount}):`);
  for (const q of result.questions) {
    console.log(`    - ${q}`);
  }

  return result;
}

async function runWorkflow() {
  console.log('\n========================================');
  console.log('4. Running csv-to-questions workflow');
  console.log('========================================\n');

  const workflow = client.getWorkflow('csv-to-questions');
  const run = await workflow.createRun();

  console.log(`Run ID: ${run.runId}`);
  console.log(`Input: { csvUrl: "${SAMPLE_CSV_URL}" }\n`);

  const result = await run.startAsync({
    inputData: { csvUrl: SAMPLE_CSV_URL },
  });

  console.log('Workflow result:');
  console.log(`  Status: ${result.status}`);
  if (result.result) {
    const output = result.result as { questions?: string[]; success?: boolean };
    console.log(`  Success: ${output.success}`);
    if (output.questions) {
      console.log(`  Questions (${output.questions.length}):`);
      for (const q of output.questions) {
        console.log(`    - ${q}`);
      }
    }
  }

  return result;
}

async function callAgent() {
  console.log('\n========================================');
  console.log('5. Calling csvQuestionAgent via generate');
  console.log('========================================\n');

  const agent = client.getAgent('csvQuestionAgent');
  const details = await agent.details();
  console.log(`Agent: ${details.name}`);
  console.log(`Model: ${details.model}\n`);

  const response = await agent.generate([
    {
      role: 'user',
      content: `Generate 3 questions about this CSV dataset: ${SAMPLE_CSV_URL}`,
    },
  ]);

  console.log('Agent response:');
  console.log(response.text);

  return response;
}

async function main() {
  console.log('Mastra Client Demo');
  console.log('==================');
  console.log(`Connecting to: ${client.baseUrl ?? 'http://localhost:4111'}`);

  try {
    // 1. List tools
    await listAllTools();

    // 2. Call download-csv-tool
    const csvResult = await callDownloadCsvTool();

    // 3. Call generate-questions-from-text-tool with the summary
    await callGenerateQuestionsTool(csvResult.summary);

    // 4. Run the full workflow
    await runWorkflow();

    // 5. Call the agent directly
    await callAgent();

    console.log('\n========================================');
    console.log('All done!');
    console.log('========================================\n');
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    console.error(
      '\nMake sure the Mastra server is running: npm run dev',
    );
    process.exit(1);
  }
}

main();
