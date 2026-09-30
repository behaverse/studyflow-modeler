import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { examplePath } from './utils';

/** `studyflow mcp`: an MCP client lists the study's tools, edits through one, checks, and saves back to the file. */
test('mcp serves the study tools on stdio, and save writes the edit back', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyflow-mcp-'));
  execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', 'packages/cli', '--outDir', path.join(dir, 'bin'), '--logLevel', 'error']);
  const file = path.join(dir, 'loop.studyflow.yaml');
  copyFileSync(examplePath('drawn_loop'), file);
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'set', arguments: { id: 'Gate', attribute: 'name', value: 'Again?' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'set', arguments: { id: 'Nowhere', attribute: 'name', value: 'x' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'check', arguments: {} } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'set', arguments: { id: 'Say', attribute: 'loopCharacteristics', value: { type: 'StandardLoopCharacteristics', loopMaximum: 2 } } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'save', arguments: {} } },
  ];
  const run = spawnSync(process.execPath, [path.join(dir, 'bin', 'studyflow.mjs'), 'mcp', file], {
    input: messages.map((message) => JSON.stringify(message)).join('\n'), encoding: 'utf8',
  });
  const replies = new Map(run.stdout.trim().split('\n').map((line) => JSON.parse(line)).map((reply) => [reply.id, reply.result]));

  expect(replies.get(1).capabilities).toEqual({ tools: {} });
  const names = replies.get(2).tools.map((tool: { name: string }) => tool.name);
  expect(names).toEqual(expect.arrayContaining(['document', 'set', 'add', 'check', 'save']));
  expect(replies.get(3).isError).toBe(false);
  expect(replies.get(4).isError, 'a refusal is an error result, with its reason').toBe(true);
  expect(replies.get(5).structuredContent.ok).toBe(true);
  expect(replies.get(6).structuredContent.ok).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain('name: Again?');
  // A structured attribute is set as the file spells it, and the file holds it.
  expect(replies.get(7).isError).toBe(false);
  expect(readFileSync(file, 'utf8')).toContain('loopMaximum: 2');
});
