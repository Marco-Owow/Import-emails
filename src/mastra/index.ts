import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';
import { ingestWorkflow } from './workflows/ingest-workflow';
import { parseWorkflow } from './workflows/parse-workflow';
import { extractionAgent } from './agents/extraction-agent';

const storage = new PostgresStore({
  id: 'mastra-storage',
  connectionString: process.env.DATABASE_URL!,
});

export const mastra = new Mastra({
  workflows: {
    ingestWorkflow,
    parseWorkflow,
  },
  agents: {
    extractionAgent,
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
