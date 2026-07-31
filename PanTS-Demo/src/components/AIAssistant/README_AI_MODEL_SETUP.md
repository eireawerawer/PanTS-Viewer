# BodyMaps AI: Local Model Setup

This guide covers only the local AI models used by the BodyMaps AI assistant.

## Models

BodyMaps uses the following Ollama models:

- `qwen3:4b` — default model for fast text conversations
- `llama3.1:latest` — alternative text model
- `qwen3-vl:4b` — vision model for images and scanned PDFs

## 1. Install Ollama

Download and install Ollama for Windows:

https://ollama.com/download/windows

Close PowerShell after installation, open a new PowerShell window, and confirm that Ollama is installed:

```powershell
ollama --version
```

`qwen3-vl:4b` requires Ollama `0.12.7` or newer.

## 2. Download the models

Run:

```powershell
ollama pull qwen3:4b
ollama pull llama3.1:latest
ollama pull qwen3-vl:4b
```

The downloads may take several minutes.

## 3. Confirm the models are installed

Run:

```powershell
ollama list
```

The output should include:

```text
qwen3:4b
llama3.1:latest
qwen3-vl:4b
```

## 4. Test the models

Test `qwen3:4b`:

```powershell
ollama run qwen3:4b "Reply with: qwen ready"
```

Test `llama3.1:latest`:

```powershell
ollama run llama3.1:latest "Reply with: llama ready"
```

Test `qwen3-vl:4b`:

```powershell
ollama run qwen3-vl:4b "Reply with: vision model ready"
```

Press `Ctrl+C` after each response to exit the model session.

## 5. Confirm the Ollama API is running

Ollama normally starts automatically in the background on Windows.

Run:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

The response should contain the installed models.

If the command cannot connect, open Ollama from the Windows Start menu and run the command again.

## 6. Configure BodyMaps

Open:

```text
flask-server\.env
```

Add:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
BODYMAPS_OLLAMA_MODEL=qwen3:4b
BODYMAPS_OLLAMA_VISION_MODEL=qwen3-vl:4b
OLLAMA_LIST_TIMEOUT_SECONDS=5
OLLAMA_CHAT_TIMEOUT_SECONDS=180
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_CTX=8192
OLLAMA_NUM_PREDICT=512
OLLAMA_THINK=false
```

Restart the BodyMaps backend after editing the `.env` file.

`qwen3:4b` is the default text model. After `llama3.1:latest` is downloaded, it should also appear in the BodyMaps model menu. BodyMaps uses `qwen3-vl:4b` when an attached image requires vision.

## 7. Reset the selected model

If BodyMaps continues selecting an old model, open the browser developer console and run:

```javascript
localStorage.removeItem("bodymaps-ai-model")
```

Reload the page and select the correct model.

## Optional: Lower-memory vision model

For computers with limited memory, install:

```powershell
ollama pull qwen3-vl:2b
```

Then change:

```dotenv
BODYMAPS_OLLAMA_VISION_MODEL=qwen3-vl:2b
```

Restart the backend after changing the model.

## Troubleshooting

#### `ollama` is not recognized

Close and reopen PowerShell.

If the command still does not work, reinstall Ollama:

https://ollama.com/download/windows

#### Ollama cannot be reached

Run:

```powershell
ollama list
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

If both commands fail, open Ollama from the Windows Start menu.

#### A model does not appear in BodyMaps

Confirm that it is installed:

```powershell
ollama list
```

Restart the BodyMaps backend and reload the webpage.

#### Responses are slow

Use `qwen3:4b` for normal text conversations.

Confirm that the following settings are in `flask-server\.env`:

```dotenv
OLLAMA_THINK=false
OLLAMA_KEEP_ALIVE=30m
```

The first response may be slower because Ollama must load the model into memory.

To inspect the currently loaded model, run:

```powershell
ollama ps
```

#### Remove and reinstall a model

```powershell
ollama rm qwen3:4b
ollama pull qwen3:4b
```

Replace `qwen3:4b` with `llama3.1:latest` or `qwen3-vl:4b` to reinstall a different model.
