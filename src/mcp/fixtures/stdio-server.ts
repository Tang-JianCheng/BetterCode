import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'bettercode-stdio-fixture',
  version: '1.0.0',
});

server.registerTool('echo', {
  description: '回显输入并验证环境变量',
  inputSchema: {
    value: z.string(),
    expectedEnv: z.string().optional(),
  },
  annotations: { readOnlyHint: true },
}, async ({ value, expectedEnv }) => ({
  content: [{
    type: 'text',
    text: JSON.stringify({
      value,
      envMatches: expectedEnv === undefined
        || process.env.BETTERCODE_MCP_FIXTURE_VALUE === expectedEnv,
    }),
  }],
  structuredContent: { value },
}));

server.registerTool('delay_echo', {
  description: '延迟后回显输入',
  inputSchema: {
    value: z.string(),
    delayMs: z.number().int().min(0).max(2_000),
  },
  annotations: { readOnlyHint: true },
}, async ({ value, delayMs }) => {
  await new Promise(resolve => setTimeout(resolve, delayMs));
  return { content: [{ type: 'text', text: value }] };
});

server.registerTool('business_error', {
  description: '返回受控业务错误',
  inputSchema: { message: z.string() },
}, async ({ message }) => ({
  isError: true,
  content: [{ type: 'text', text: message }],
}));

server.registerTool('media', {
  description: '返回用于摘要测试的媒体内容',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => ({
  content: [{
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.from('fixture-image').toString('base64'),
  }],
}));

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await server.close();
}

process.once('SIGTERM', () => {
  void close().finally(() => process.exit(0));
});
process.once('SIGINT', () => {
  void close().finally(() => process.exit(0));
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('BetterCode MCP stdio fixture ready');
