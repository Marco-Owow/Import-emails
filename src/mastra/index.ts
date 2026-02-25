import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { PostgresStore } from '@mastra/pg';
import { csvToQuestionsWorkflow } from './workflows/csv-to-questions-workflow';
import { ingestWorkflow } from './workflows/ingest-workflow';
import { parseWorkflow } from './workflows/parse-workflow';
import { textQuestionAgent } from './agents/text-question-agent';
import { csvQuestionAgent } from './agents/csv-question-agent';
import { csvSummarizationAgent } from './agents/csv-summarization-agent';
import { pdfAgent } from './agents/pdf-agent';

// Use PostgresStore when DATABASE_URL is set, otherwise fall back to LibSQL for dev/demo
const storage = process.env.DATABASE_URL
  ? new PostgresStore({
      id: 'mastra-storage',
      connectionString: process.env.DATABASE_URL,
    })
  : new LibSQLStore({
      id: 'mastra-storage',
      url: ':memory:',
    });

export const mastra = new Mastra({
  workflows: {
    csvToQuestionsWorkflow,
    ingestWorkflow,
    parseWorkflow,
  },
  agents: {
    textQuestionAgent,
    csvQuestionAgent,
    csvSummarizationAgent,
    pdfAgent,
  },
  storage,
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(),
          new CloudExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
});
