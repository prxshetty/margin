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
            "stream": stream,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        if stream:
            return self._stream_generate(url, headers, payload)
        else:
            return self._blocking_generate(url, headers, payload)

    def _blocking_generate(self, url: str, headers: dict, payload: dict) -> str:
        """Blocking (non-streaming) generation."""
        payload["stream"] = False
        response = requests.post(url, headers=headers, json=payload, timeout=300)
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return self._clean_reasoning(content)

    def _stream_generate(self, url: str, headers: dict, payload: dict) -> str:
        """Streaming generation — yields content as it arrives."""
        full_content = ""
        in_thinking = config.REASONING_MODEL
        thinking_buffer = ""

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
                                    if in_thinking:
                                        thinking_buffer += content
                                        # All known closing channel tags from local reasoning models
                                        CLOSING_TAGS = [
                                            "<channel|>",
                                            "<|channel|>",
                                            "</channel|>",
                                            "|channel|>",
                                        ]
                                        found_close = False
                                        for close_tag in CLOSING_TAGS:
                                            if close_tag in thinking_buffer:
                                                idx = thinking_buffer.find(close_tag)
                                                remaining = thinking_buffer[idx + len(close_tag):]
                                                in_thinking = False
                                                found_close = True
                                                if remaining:
                                                    full_content += remaining
                                                    yield remaining
                                                break
                                        if not found_close and len(thinking_buffer) > 6000:
                                            # Fail-safe: if the reasoning block is extremely long, just flush it
                                            in_thinking = False
                                            full_content += thinking_buffer
                                            yield thinking_buffer
                                    else:
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
            "stream": False,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        response = requests.post(url, headers=headers, json=payload, timeout=300)
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return self._clean_reasoning(content)

    def _clean_reasoning(self, text: str) -> str:
        # Always attempt to clean reasoning tags to be completely safe against 
        # hallucinations and environment variable caching issues.
        import re

        CLOSING_TAGS = [
            "<channel|>",      # DeepSeek standard closing
            "<|channel|>",     # Alternative DeepSeek
            "</channel|>",     # Malformed but seen in practice
            "|channel|>",      # Truncated variant
        ]

        # Use rfind to find the LAST closing tag. This handles cases where the model
        # outputs multiple reasoning blocks or restarts its thought process.
        last_idx = -1
        last_tag_len = 0
        for tag in CLOSING_TAGS:
            idx = text.rfind(tag)
            if idx > last_idx:
                last_idx = idx
                last_tag_len = len(tag)
                
        if last_idx != -1:
            text = text[last_idx + last_tag_len:].strip()
            
        # Fallback 1: strip native <think>...</think> tags and their inner content
        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
        text = re.sub(r'<think>.*', '', text, flags=re.DOTALL)
            
        # Fallback 2: strip any cleanly paired <...channel...> blocks that remain
        text = re.sub(r'<\|?channel\|?>.*?<[\|/]?channel[\|>]', '', text, flags=re.DOTALL)
        
        # Fallback 3: strip malformed greedy tags
        text = re.sub(r'<[\|/]?channel[\|>][^<]*', '', text, flags=re.DOTALL)

        text = text.strip()

        # Clean up stray bullet points or prefixes that were attached to the reasoning block
        # For example, if the model output `* <|channel|>thought...`, after stripping the tags
        # we are left with a leading `* ` followed by nothing or the actual content.
        text = re.sub(r'^[\*\-\+]\s*\n?', '', text)

        return text.strip()


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