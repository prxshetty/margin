"""
LMStudio client — OpenAI-compatible API with streaming support.
"""

from typing import Generator
import requests
import json
import config


class LLMClient:
    """Client for LMStudio's OpenAI-compatible API."""

    def __init__(
        self,
        model: str = None,
        temperature: float = None,
        base_url: str = None,
        api_key: str = None,
        is_thinking: bool = True,
        custom_opening_tags: list[str] = None,
        custom_closing_tags: list[str] = None,
    ):
        base_url = base_url or config.LMSTUDIO["base_url"]
        if base_url:
            base_url = base_url.rstrip("/")
            if not base_url.endswith("/v1"):
                base_url += "/v1"
        self.base_url = base_url
        self.model = model or config.LMSTUDIO["model"]
        self.temperature = temperature if temperature is not None else config.LMSTUDIO["temperature"]
        self.api_key = api_key
        self.is_thinking = is_thinking
        self.custom_opening_tags = custom_opening_tags or []
        self.custom_closing_tags = custom_closing_tags or []
        self.last_usage = None

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
        if getattr(self, "api_key", None):
            headers["Authorization"] = f"Bearer {self.api_key}"
            
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
        self.last_usage = data.get("usage") or {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0
        }
        content = data["choices"][0]["message"]["content"]
        return self._clean_reasoning(content)

    def _stream_generate(self, url: str, headers: dict, payload: dict) -> Generator[tuple[str, str], None, None]:
        """Streaming generation — yields content as it arrives.

        Handles both DeepSeek <|channel|> and Granite/standard <think>...</think>
        reasoning block styles. Supports auto/on/off thinking modes and custom tag pairs.
        """
        full_content = ""
        
        in_thinking = False
            
        thinking_buffer = ""
        pending = ""

        OPENING_TAGS = ["<|channel|>", "<think>"] + self.custom_opening_tags
        CLOSING_TAGS = [
            "<channel|>",
            "<|channel|>",
            "</channel|>",
            "|channel|>",
            "</think>",
        ] + self.custom_closing_tags

        # Longest tag determines lookahead length
        all_tags = OPENING_TAGS + CLOSING_TAGS
        MAX_TAG_LEN = max(len(tag) for tag in all_tags) if all_tags else 12

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
                            if "usage" in data and data["usage"]:
                                self.last_usage = data["usage"]
                            if "choices" in data and len(data["choices"]) > 0:
                                delta = data["choices"][0].get("delta", {})
                                
                                reasoning_content = delta.get("reasoning_content", "")
                                if reasoning_content:
                                    yield ("thinking", reasoning_content)

                                content = delta.get("content", "")
                                if content:
                                    if not self.is_thinking:
                                        full_content += content
                                        yield ("chunk", content)
                                    elif in_thinking:
                                        thinking_buffer += content
                                        found_close = False
                                        for close_tag in CLOSING_TAGS:
                                            if close_tag in thinking_buffer:
                                                idx = thinking_buffer.find(close_tag)
                                                prev_len = len(thinking_buffer) - len(content)
                                                thinking_text = thinking_buffer[prev_len:idx]
                                                if thinking_text:
                                                    yield ("thinking", thinking_text)
                                                
                                                remaining = thinking_buffer[idx + len(close_tag):]
                                                in_thinking = False
                                                found_close = True
                                                thinking_buffer = ""
                                                if remaining:
                                                    full_content += remaining
                                                    yield ("chunk", remaining)
                                                break
                                        if not found_close:
                                            yield ("thinking", content)
                                            if len(thinking_buffer) > 6000:
                                                # Fail-safe: reasoning block too long, flush and continue
                                                in_thinking = False
                                                thinking_buffer = ""
                                    else:
                                        # Accumulate in lookahead buffer to detect opening tags
                                        pending += content
                                        found_open = False
                                        for open_tag in OPENING_TAGS:
                                            if open_tag in pending:
                                                idx = pending.find(open_tag)
                                                before = pending[:idx]
                                                if before:
                                                    full_content += before
                                                    yield ("chunk", before)
                                                in_thinking = True
                                                thinking_buffer = pending[idx + len(open_tag):]
                                                pending = ""
                                                found_open = True
                                                break

                                        if not found_open and len(pending) > MAX_TAG_LEN:
                                            # Safe to flush: retain only the tail that could
                                            # be the start of an opening tag spanning chunks.
                                            safe = pending[:-MAX_TAG_LEN]
                                            full_content += safe
                                            yield ("chunk", safe)
                                            pending = pending[-MAX_TAG_LEN:]
                        except json.JSONDecodeError:
                            continue

            # Flush any remaining lookahead buffer
            if pending and not in_thinking:
                full_content += pending
                yield ("chunk", pending)

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
        if getattr(self, "api_key", None):
            headers["Authorization"] = f"Bearer {self.api_key}"
            
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
        self.last_usage = data.get("usage") or {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0
        }
        
        self.last_model_used = data.get("model", self.model)
        
        content = data["choices"][0]["message"]["content"]
        return self._clean_reasoning(content)

    def generate_to_completion_with_history(
        self,
        messages: list[dict],
        temperature: float = None,
        max_tokens: int = None,
    ) -> str:
        """Get full completion with a pre-built history (blocking internally)."""
        url = f"{self.base_url}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if getattr(self, "api_key", None):
            headers["Authorization"] = f"Bearer {self.api_key}"
            
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.temperature,
            "stream": False,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        response = requests.post(url, headers=headers, json=payload, timeout=300)
        response.raise_for_status()
        data = response.json()
        self.last_usage = data.get("usage") or {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0
        }
        
        self.last_model_used = data.get("model", self.model)
        
        content = data["choices"][0]["message"]["content"]
        return self._clean_reasoning(content)

    def generate_stream_with_history(
        self,
        messages: list[dict],
        temperature: float = None,
        max_tokens: int = None,
    ):
        """Streaming generation with pre-built history."""
        url = f"{self.base_url}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if getattr(self, "api_key", None):
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.temperature,
            "stream": True,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        
        return self._stream_generate(url, headers, payload)

    def _clean_reasoning(self, text: str) -> str:
        if not self.is_thinking:
            return text

        # Always attempt to clean reasoning tags to be completely safe against 
        # hallucinations and environment variable caching issues.
        import re

        CLOSING_TAGS = [
            "<channel|>",      # DeepSeek standard closing
            "<|channel|>",     # Alternative DeepSeek
            "</channel|>",     # Malformed but seen in practice
            "|channel|>",      # Truncated variant
            "</think>",        # Standard HuggingFace/Granite style
        ] + self.custom_closing_tags

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

        # Fallback 1b: strip custom tags
        for open_tag, close_tag in zip(self.custom_opening_tags, self.custom_closing_tags):
            escaped_open = re.escape(open_tag)
            escaped_close = re.escape(close_tag)
            text = re.sub(f'{escaped_open}.*?{escaped_close}', '', text, flags=re.DOTALL)
            text = re.sub(f'{escaped_open}.*', '', text, flags=re.DOTALL)
            
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