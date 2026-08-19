#!/usr/bin/env node
import { getConfig } from './shared/config.js';
import { startServer } from './mcp/server.js';

const config = getConfig();

startServer(config).catch((err) => {
  console.error('Failed to start DesignScout MCP server:', err);
  process.exit(1);
});
