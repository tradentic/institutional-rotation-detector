import OpenAI from 'openai';

type ResponseCreateParams = Parameters<OpenAI['responses']['create']>[0];

export interface OpenAIOptions {
  apiKey?: string;
}

export function createOpenAIClient(options: OpenAIOptions = {}): OpenAI {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }
  return new OpenAI({ apiKey });
}

export async function runResponses(options: {
  client?: OpenAI;
  input: ResponseCreateParams;
}): Promise<string> {
  const client = options.client ?? createOpenAIClient();
  const response = await client.responses.create(options.input);
  const text = response.output
    ?.map((item) => ('content' in item ? item.content?.map((c) => ('text' in c ? c.text ?? '' : '')).join('') : ''))
    .join('')
    ?.trim();
  return text ?? '';
}
