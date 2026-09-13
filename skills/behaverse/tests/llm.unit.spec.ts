import { expect, test } from '@playwright/test';
import { botForUnity } from '@skills/behaverse/browser/botConfig';

test('botForUnity: strips runner-only keys and rewrites ResponseSource=llm -> external', async () => {
  // Unity needs ResponseSource="external" to emit AwaitingResponse, and throws on LLM/Prompt (unknown fields).
  const result = botForUnity({
    ResponseSource: 'llm',
    LLM: { Provider: 'claude', Model: 'm' },
    Prompt: 'persona',
    IncludeScreenshot: true,
    Speed: 20,
  });
  expect(result).toEqual({
    ResponseSource: 'external',
    IncludeScreenshot: true,
    Speed: 20,
  });
});
