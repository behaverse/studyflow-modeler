/**
 * `studyflow mcp <file>`: the study in `file` as a Model Context Protocol server on stdio, so an AI assistant edits
 * it with the tools the canvas's `Study` offers (`Study.tools`), checks it with `check` (what `studyflow validate`
 * checks of a plan), and writes it back with `save`. JSON-RPC 2.0, one message per line, as MCP's stdio transport
 * frames them; nothing else is written to stdout.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import { Study } from '@canvas/index.ts';
import { planChecks } from '@core/checks';
import { schemaModdle } from '@cli/studyfile';

const PROTOCOL = '2025-06-18';

type Request = { jsonrpc: '2.0'; id?: number | string; method: string; params?: any };

/** The tools beyond the study's own: a check and a write to the file. */
const FILE_TOOLS = [
  {
    name: 'check',
    description: 'What `studyflow validate` checks of a plan: a graph every step of which lies on a path from a start to an end, the paths the runtimes walk, FEEL expressions, and the columns each step reads. An empty list is a well-formed plan.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'save',
    description: 'Write the study back to the file it was opened from, as a .studyflow.yaml (or BPMN XML, when the file is one).',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

export async function mcp(path: string): Promise<void> {
  const moddle = await schemaModdle();
  const warnings: string[] = [];
  const study = await Study.open(await readFile(path, 'utf8'), { moddle, onWarning: (message: string) => warnings.push(message) } as never);
  const xml = /\.(bpmn|xml)$/i.test(path);
  const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const reply = (id: Request['id'], result: object) => send({ jsonrpc: '2.0', id, result });
  const fail = (id: Request['id'], code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });

  const call = async (name: string, args: unknown): Promise<object> => {
    if (name === 'check') {
      const issues = planChecks(study.definitions as never);
      return { ok: !issues.some((issue) => issue.severity === 'error'), issues, warnings };
    }
    if (name === 'save') {
      await writeFile(path, xml ? await study.toXml() : study.toYaml());
      return { ok: true, path };
    }
    return study.call(name, args);
  };

  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let request: Request;
    try {
      request = JSON.parse(line);
    } catch {
      fail(null as never, -32700, 'parse error');
      continue;
    }
    const { id, method, params } = request;
    if (id === undefined) continue; // a notification: `notifications/initialized` and the like
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'studyflow', version: import.meta.env?.APP_VERSION ?? 'dev' },
          instructions: `The study in ${path}. Read it with \`document\`, \`list\` or \`get\`; change it with the write tools, each all or nothing and undoable; \`check\` it; \`save\` writes it back.`,
        });
        break;
      case 'ping':
        reply(id, {});
        break;
      case 'tools/list':
        reply(id, { tools: [...Study.tools, ...FILE_TOOLS] });
        break;
      case 'tools/call': {
        const result = await call(String(params?.name), params?.arguments ?? {}) as { ok?: boolean };
        reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: result.ok === false });
        break;
      }
      default:
        fail(id, -32601, `no method ${method}`);
    }
  }
}
