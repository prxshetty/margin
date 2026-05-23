import { createOpenAI } from '@ai-sdk/openai'

export const localLLM = createOpenAI({
  baseURL: 'http://localhost:1234/v1',
  apiKey: 'lm-studio', // LM Studio ignores this but SDK requires it
})
