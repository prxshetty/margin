# Getting Started

## Prerequisites

margin has two parts: a **backend** (AI engine) and a **frontend** (editor interface). You'll need both running.

### Backend (Python)

- Python 3.10 or newer
  ```bash
  python --version
  ```
  If you don't have Python, download it from [python.org](https://python.org).

### Frontend (Node.js)

- Node.js 18 or newer
  ```bash
  node --version
  ```
  Download from [nodejs.org](https://nodejs.org) if needed.

### AI Provider (pick one)

margin needs an AI model to power its writing assistant. You have two options:

**Option A -- Local (Private, Offline)**
Run a model entirely on your machine. No internet required, no data leaves your computer.

- [Ollama](https://ollama.ai) -- runs on `http://localhost:11434`
- [LM Studio](https://lmstudio.ai) -- runs on `http://localhost:1234`
- Any OpenAI-compatible local server

**Option B -- Cloud API**
Use an online provider. Your content is sent to their servers for processing.

- [OpenAI](https://platform.openai.com/api-keys)
- [Anthropic](https://console.anthropic.com)
- [Google Gemini](https://aistudio.google.com/apikey)
- [Grok (xAI)](https://console.x.ai)
- [OpenRouter](https://openrouter.ai/keys)
- [Groq](https://console.groq.com/keys)
- Any OpenAI-compatible cloud provider

> All cloud providers require an API key. margin stores it securely in your local `settings.json` file.

::: tip You don't need to edit `.env` files -- everything is configured inside margin's settings UI.
:::

## Installation

### Step 1: Clone the repository

```bash
git clone https://github.com/prxshetty/margin.git
cd margin
```

### Step 2: Set up the backend

```bash
pip install -r requirements.txt
cp .env.example .env
```

Start the backend server:

```bash
uvicorn api.main:app --reload
```

The backend will be available at `http://localhost:8000`.

### Step 3: Set up the frontend

Open a **new terminal window**, navigate to the UI folder:

```bash
cd ui
npm install
npm run dev
```

The editor will open at `http://localhost:5173`.

### Step 4: Configure your AI provider

1. Open margin in your browser.
2. Click the **gear icon** to open Settings.
3. Go to **Endpoints** tab.
4. Choose your AI provider:
   - Select `.env Default` if you already configured it in your `.env` file.
   - Or click **Add New Endpoint**, give it a name (e.g., "Ollama"), enter the URL, and click **Save Endpoint**.
5. Click **Test Connection** to verify everything works.
6. Select your endpoint as the **Active Endpoint**.

### Step 5: Start writing

The default workspace (`sample-workspace`) is loaded automatically. It includes sample characters, a chapter, and style presets so you can start experimenting right away.

You can link your own workspace folder from **Settings > General > Workspace Directory**.

## Next Steps

- Learn about [workspaces and settings](./configuration/general.md)
- Understand [AI assist modes and the writing guide](./writing-guide.md)
- Create your own [character profiles and style guides](./writing-guide.md#character-profiles)
