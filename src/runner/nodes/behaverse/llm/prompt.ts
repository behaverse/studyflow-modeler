import type { LLMBotInput, ProviderRequest } from '@/runner/nodes/behaverse/llm/types';

const DEFAULT_SYSTEM = `You are simulating a participant in a cognitive task.
Respond with exactly one of the response options, and nothing else.`;

function formatHistoryEntry(entry: { trialIndex: number; stimulus: unknown; chosenResponse: string }): string {
  const stim = formatStimulus(entry.stimulus);
  return `  trial ${entry.trialIndex}: stimulus=${stim}, response=${entry.chosenResponse}`;
}

function formatStimulus(stimulus: unknown): string {
  if (stimulus == null) return 'null';
  if (typeof stimulus === 'string' || typeof stimulus === 'number' || typeof stimulus === 'boolean') {
    return String(stimulus);
  }
  try {
    return JSON.stringify(stimulus);
  } catch {
    return String(stimulus);
  }
}

function parseDataUrl(url: string): { mediaType: string; data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(url.trim());
  if (!match) return undefined;
  return { mediaType: match[1], data: match[2].replace(/\s+/g, '') };
}

export function buildPrompt(input: LLMBotInput, model: string): ProviderRequest {
  const system = input.prompt.trim() || DEFAULT_SYSTEM;
  const image = input.screenshot ? parseDataUrl(input.screenshot) : undefined;

  const lines: string[] = [];
  lines.push(`Task: ${input.taskId}`);

  if (input.taskConfig && Object.keys(input.taskConfig).length > 0) {
    lines.push(`Task configuration:`);
    lines.push(JSON.stringify(input.taskConfig, null, 2));
  }

  if (input.history.length > 0) {
    lines.push('');
    lines.push(`Previous trials in this task:`);
    for (const entry of input.history) lines.push(formatHistoryEntry(entry));
  }

  lines.push('');
  lines.push(`Current trial ${input.trialIndex}:`);
  lines.push(`  stimulus: ${formatStimulus(input.stimulus)}`);
  lines.push(`  response options: ${input.responseOptions.join(', ')}`);
  if (image) {
    lines.push(`  screenshot: attached (use the image to decide; ignore the textual stimulus if they disagree)`);
  }
  lines.push('');
  lines.push(`Reply with exactly one of the response options. No explanation, no punctuation, no extra text.`);

  return {
    system,
    user: lines.join('\n'),
    model,
    responseOptions: input.responseOptions,
    ...(image ? { image } : {}),
  };
}
