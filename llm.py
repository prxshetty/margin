"""
LMStudio client — OpenAI-compatible API with streaming support.
"""

import requests
import json
import config


class LLMClient:
    """Client for LMStudio's OpenAI-compatible API."""

    def __init__(self, model: str = None, temperature: float = None):
        self.base_url = config.LMSTUDIO["base_url"]
        self.model = model or config.LMSTUDIO["model"]
        self.temperature = temperature if temperature is not None else config.LMSTUDIO["temperature"]
        self.max_tokens = config.LMSTUDIO["max_tokens"]

    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        stream: bool = True,
        temperature: float = None,
        max_tokens: int = None,
    ) -> str:
        """Generate text with the LLM. Use streaming=True for real-time output."""
        url = f"{self.base_url}/chat/completions"

        headers = {"Content-Type": "application/json"}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature or self.temperature,
            "max_tokens": max_tokens or self.max_tokens,
            "stream": stream,
        }

        if stream:
            return self._stream_generate(url, headers, payload)
        else:
            return self._blocking_generate(url, headers, payload)

    def _blocking_generate(self, url: str, headers: dict, payload: dict) -> str:
        """Blocking (non-streaming) generation."""
        payload["stream"] = False
        response = requests.post(url, headers=headers, json=payload, timeout=120)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]

    def _stream_generate(self, url: str, headers: dict, payload: dict) -> str:
        """Streaming generation — yields content as it arrives."""
        full_content = ""
        try:
            response = requests.post(
                url, headers=headers, json=payload, stream=True, timeout=180
            )
            response.raise_for_status()

            for chunk in response.iter_lines():
                if chunk:
                    chunk_str = chunk.decode("utf-8")
                    if chunk_str.startswith("data: "):
                        data_str = chunk_str[6:]
                        if data_str == "[DONE]":
                            break
                        try:
                            data = json.loads(data_str)
                            if "choices" in data and len(data["choices"]) > 0:
                                delta = data["choices"][0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    full_content += content
                                    yield content
                        except json.JSONDecodeError:
                            continue
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"LMStudio API error: {e}")

    def generate_to_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = None,
        max_tokens: int = None,
    ) -> str:
        """Get full completion (blocking internally)."""
        url = f"{self.base_url}/chat/completions"
        headers = {"Content-Type": "application/json"}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature or self.temperature,
            "max_tokens": max_tokens or self.max_tokens,
            "stream": False,
        }
        response = requests.post(url, headers=headers, json=payload, timeout=120)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


def stream_print(generator):
    """Print streaming content to stdout in real-time."""
    for chunk in generator:
        print(chunk, end="", flush=True)
    print()


if __name__ == "__main__":
    client = LLMClient()
    print("Testing LMStudio connection...")
    try:
        result = client.generate_to_completion(
            system_prompt="You are a helpful assistant.",
            user_prompt="Say 'Hello, I'm working!' in exactly those words.",
            max_tokens=50,
        )
        print(f"Response: {result}")
    except Exception as e:
        print(f"Error: {e}")