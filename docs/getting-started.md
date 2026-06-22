# Getting Started

## Prerequisites

margin has two parts: a **backend** (AI engine) and a **frontend** (editor interface). You'll need both running.

### Backend (Python)

- Python 3.10 or newer

  ```bash
  python --version      # macOS / Linux
  python --version      # Windows (or python3 if using the Windows store alias)
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

> All cloud providers require an API key. margin stores it securely in your local settings file.

::: tip You don't need to edit `.env` files -- everything is configured inside margin's settings UI.
:::

## Installation

### Step 1: Clone the repository

```bash
git clone https://github.com/prxshetty/margin.git
cd margin
```

### Step 2: Set up the backend

margin includes startup scripts that handle everything automatically. Pick the right one for your OS:

::: code-group

```bash [macOS / Linux]
./start.sh
```

```powershell [Windows]
start.bat          # double-click, or run in cmd
powershell -ExecutionPolicy Bypass -File start.ps1
```

:::

The script will:
1. Create a Python virtual environment (if one doesn't exist)
2. Install Python dependencies
3. Install frontend dependencies
4. Launch both the API server and the editor UI in parallel

#### Manual setup (optional)

If you prefer to run things step by step:

::: code-group

```bash [macOS / Linux]
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

```powershell [Windows]
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

:::

The backend will be available at `http://localhost:8000`.

### Step 3: Set up the frontend

If you used the startup script, this is already done. Otherwise, open a **new terminal window** and run:

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
