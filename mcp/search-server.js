#!/usr/bin/env node
// Thin stdio MCP server exposing semantic search over the message log to
// Claude Code / Claude Desktop. Calls the same lib/db.js + lib/embeddings.js
// core as api/search.js - no HTTP hop needed when running locally.
//
// Register in Claude Code: see WORKFLOW.md -> "Register the search MCP server".

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { embed } from '../lib/embeddings.js';
import { searchMessages } from '../lib/db.js';

const server = new Server(
  { name: 'personal-secretary-search', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

const SEARCH_TOOL = {
  name: 'search_messages',
  description:
    'Semantic search over the personal-secretary Telegram message log. Returns the ' +
    'top-K messages closest in meaning to the query (not keyword match).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language question or topic to search for' },
      k: { type: 'number', description: 'Number of results to return (default from SEARCH_TOP_K env, else 20)' },
      chatId: { type: 'string', description: 'Optional: restrict results to one Telegram chat id' },
    },
    required: ['query'],
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SEARCH_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== SEARCH_TOOL.name) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { query, k, chatId } = request.params.arguments || {};
  const queryEmbedding = await embed(query);
  const rows = await searchMessages({
    ownerId: process.env.OWNER_ID,
    queryEmbedding,
    k: k || Number(process.env.SEARCH_TOP_K) || 20,
    chatId,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
