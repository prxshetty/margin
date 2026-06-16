# Endpoints

Endpoints connect margin to an AI model. You can use local models (completely private, offline) or cloud APIs.

## Active Endpoint

Select which endpoint margin should use for AI requests:

- **.env Default**: Uses settings from your `.env` file. This is the traditional method and useful if you prefer environment-based configuration.
- **Custom endpoints**: Any endpoint you've added via the UI.

## Adding an Endpoint

1. Fill in the **Add New Endpoint** form:

   | Field | Description |
   |-------|-------------|
   | **Name** | A label for this endpoint (e.g., "Ollama", "OpenAI", "My Local Model"). |
   | **Base URL** | The full URL of your API (e.g., `http://localhost:11434/v1`, `https://api.openai.com/v1`). |
   | **API Key** | Your API key (required for cloud providers, optional for local). |
   | **Model** | The model name (e.g., `gpt-4o`, `qwen2.5-coder`). Optional -- some endpoints auto-detect. |
   | **Context Window** | The maximum context size in tokens (default: 8192). |

2. Click **Test Connection** to verify the endpoint works.
3. Click **Save Endpoint**.

### Common Local Endpoints

| Provider | Default URL | Default Port |
|----------|-------------|-------------|
| Ollama | `http://localhost:11434` | 11434 |
| LM Studio | `http://localhost:1234/v1` | 1234 |

### Cloud Providers

| Provider | Base URL |
|----------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Anthropic | `https://api.anthropic.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` |
| Grok (xAI) | `https://api.x.ai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Groq | `https://api.groq.com/openai/v1` |

> All cloud providers require an API key. You can get one from their respective console or dashboard.

::: tip API keys are stored locally in `settings.json` and never sent anywhere except to the endpoint you configure. No data leaves your machine unless you explicitly connect to a cloud provider.
:::

## Editing and Deleting Endpoints

- **Edit**: Click the pencil icon on an endpoint card to modify its settings.
- **Delete**: Click the trash icon to remove an endpoint.
