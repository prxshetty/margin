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
   | **Thinking Model** | When enabled (default), inline reasoning tags (e.g. `<think>`, `<\|channel\|>`) are stripped from the response. Disable to see the raw output including any tags the model emits. |

   When **Thinking Model** is checked, a **Custom Thinking Tags** section appears where you can add open/close tag pairs for models with non-standard reasoning tags.

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

## Reasoning Settings

Many models produce internal reasoning before generating their final output. margin can detect and separate this reasoning text from the visible response.

### Thinking Model Toggle

Each endpoint has a **Thinking Model** checkbox. It controls how inline reasoning tags in the `content` field are handled:

- **On (default)**: Inline tags like `<think>`, `<\|channel\|>`, and custom tag pairs are stripped from the prose output. The reasoning text is captured and shown in the "Thought Process" dropdown instead.
- **Off**: Tags pass through as raw text — you'll see `<think>...</think>` or `<|channel|>...</channel|>` directly in the editor output.

Some models (including LM Studio, DeepSeek, and some OpenAI-compatible providers) use a separate `reasoning_content` field in the API response rather than inline tags. This reasoning text is always captured in the "Thought Process" dropdown regardless of the toggle — the toggle only controls tag stripping from the main content stream.

### Custom Thinking Tags

Different models use different tags to delimit their reasoning. margin supports these out of the box:

| Opening | Closing |
|---------|---------|
| `<\|channel\|>` | `<channel\|>`, `<\|channel\|>`, `</channel\|>`, `\|channel\|>` |
| `<think>` | `</think>` |

If your model uses non-standard tags (e.g., `[REASONING]...[/REASONING]`), add them in the endpoint form:

1. Open the endpoint for editing.
2. Check **Thinking Model**.
3. Under **Custom Thinking Tags**, enter the opening tag (e.g., `[REASONING]`) and closing tag (e.g., `[/REASONING]`).
4. Click **Add Tag** — it appears as a removable chip.
5. Save the endpoint.

Multiple custom tag pairs are supported. Added tags are stripped alongside the built-in defaults.

### Prepend Thinking Preamble

When enabled, this injects a system prompt that instructs the model to use reasoning tags before every response. Useful for models that can reason internally but don't do it by default.

### Finding Your Model's Tags

If you see raw tags like `<think>...` or `<|channel|>...` in your output, the model is using reasoning tags that aren't being filtered. Check your endpoint's **Thinking Model** toggle and add any missing custom tags. If the toggle is on and you still see tags, add them as custom tags.

> See [AI Assist > Reasoning & Thinking](../ai-assist.md#reasoning-amp-thinking) for how reasoning appears in the editor.

## Editing and Deleting Endpoints

- **Edit**: Click the pencil icon on an endpoint card to modify its settings.
- **Delete**: Click the trash icon to remove an endpoint.
