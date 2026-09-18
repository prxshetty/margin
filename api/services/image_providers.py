"""Image generation providers. Margin owns prompt/style/storage;
providers own the provider-specific HTTP implementation.

Common contract for v1:

    generate(final_prompt, reference_bytes?) -> GeneratedImage

Styles are resolved by Margin before calling the provider. Providers
must not know about Margin's style system.

ComfyUI principle: Margin is a *client* of ComfyUI, not a workflow
manager. The user owns their API-format workflow; Margin stores a copy
plus a small input mapping (v1: positive prompt only) and overlays the
prompt onto a deep copy per generation. The saved workflow is immutable
configuration — never mutated in place.
"""

from __future__ import annotations

import base64
import io
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol


@dataclass
class GeneratedImage:
    data: bytes
    mime_type: str
    # ComfyUI seed actually submitted, for display/comparison. Cloud
    # providers leave this None.
    seed: Optional[int] = None


# ---------------------------------------------------------------------------
# Styles (Margin concern)
# ---------------------------------------------------------------------------

BUILTIN_STYLES: Dict[str, Optional[str]] = {
    # None key is represented as "None" over the wire; None prompt = no suffix.
    "None": None,
    "Cinematic": "cinematic lighting, dramatic composition, 35mm film look, rich color grade",
    "Illustration": "detailed hand-drawn illustration, expressive linework, balanced composition",
}

#: Providers offered in Settings. ComfyUI is listed but conditionally
#: usable: generation and provider-test return a 400 with guidance until
#: a workflow + prompt mapping is configured — never silently broken.
SELECTABLE_PROVIDERS = ("openai-compatible", "stability", "fal", "comfyui")

EMPTY_REGEN_PROMPT = "Create another version of this image."


def resolve_style_prompt(style_name: Any, settings: Dict[str, Any]) -> Optional[str]:
    """Map a style name to its prompt suffix. Unknown names are 400s."""
    name = style_name if style_name is not None else settings.get("image_default_style")
    if name is None:
        return None
    if isinstance(name, str) and name.strip().lower() in ("", "none", "null"):
        return None
    if not isinstance(name, str):
        raise ValueError(f"Unknown image style: {name!r}")
    key = name.strip()
    for builtin_name, prompt in BUILTIN_STYLES.items():
        if builtin_name.lower() == key.lower():
            return prompt
    customs = settings.get("image_custom_styles") or []
    if isinstance(customs, list):
        for entry in customs:
            if isinstance(entry, dict) and str(entry.get("name", "")).strip().lower() == key.lower():
                p = str(entry.get("prompt", "")).strip()
                return p or None
    raise ValueError(f"Unknown image style: {key!r}")


def list_styles(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = [{"name": n, "prompt": p, "builtin": True} for n, p in BUILTIN_STYLES.items()]
    customs = settings.get("image_custom_styles") or []
    if isinstance(customs, list):
        for entry in customs:
            if isinstance(entry, dict) and str(entry.get("name", "")).strip():
                out.append({
                    "name": str(entry["name"]).strip(),
                    "prompt": str(entry.get("prompt", "")),
                    "builtin": False,
                })
    return out


def compose_final_prompt(prompt: str, style_prompt: Optional[str]) -> str:
    prompt = (prompt or "").strip()
    if style_prompt and style_prompt.strip():
        return f"{prompt}\nStyle: {style_prompt.strip()}" if prompt else style_prompt.strip()
    return prompt


class ImageProvider(Protocol):
    def generate(self, prompt: str,
                 reference_bytes: Optional[bytes] = None) -> GeneratedImage:
        ...


def _settings_get(settings: Dict[str, Any], key: str) -> str:
    v = settings.get(key)
    return str(v or "").strip()


class OpenAICompatibleProvider:
    """OpenAI / LM Studio / vLLM style `/v1/images/*` API.

    Text-to-image uses `/v1/images/generations` (b64_json). Reference
    images use `/v1/images/edits` multipart. Both default to 1024-class
    output — no size field in v1 by design.
    """

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key or ""
        self.model = (model or "").strip()

    def _headers(self, content_json: bool = True) -> Dict[str, str]:
        h: Dict[str, str] = {}
        if content_json:
            h["Content-Type"] = "application/json"
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _decode_image_payload(self, payload: Dict[str, Any]) -> GeneratedImage:
        import urllib.request

        data = payload.get("data") or []
        if not data or not isinstance(data, list):
            raise ValueError("Image provider returned no image data")
        first = data[0] or {}
        b64 = first.get("b64_json")
        if b64:
            try:
                return GeneratedImage(data=base64.b64decode(b64), mime_type="image/png")
            except Exception as e:
                raise ValueError(f"Could not decode provider image: {e}")
        url = first.get("url")
        if url:
            req = urllib.request.Request(url, headers={"User-Agent": "margin-writing-app/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
                return GeneratedImage(
                    data=resp.read(),
                    mime_type=resp.headers.get("Content-Type", "image/png"),
                )
        raise ValueError("Image provider returned neither b64_json nor url")

    def generate(self, prompt: str,
                 reference_bytes: Optional[bytes] = None) -> GeneratedImage:
        import requests

        if not self.base_url:
            raise ValueError("Image base URL is not configured (Settings → Image Generation)")
        if not self.model:
            raise ValueError("Image model is not configured (Settings → Image Generation)")
        if not (prompt or "").strip():
            raise ValueError("Prompt is required")
        try:
            if reference_bytes:
                url = f"{self.base_url}/v1/images/edits"
                files = {"image": ("reference.png", io.BytesIO(reference_bytes), "image/png")}
                form = {"model": self.model, "prompt": prompt, "n": "1", "size": "1024x1024"}
                headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
                resp = requests.post(url, headers=headers, files=files, data=form, timeout=120)
            else:
                url = f"{self.base_url}/v1/images/generations"
                resp = requests.post(url, headers=self._headers(), json={
                    "model": self.model,
                    "prompt": prompt,
                    "n": 1,
                    "size": "1024x1024",
                    "response_format": "b64_json",
                }, timeout=120)
        except Exception as e:
            raise ValueError(f"Image provider request failed: {e}")
        if resp.status_code in (401, 403):
            raise ValueError("Image provider rejected the API key (401/403)")
        if resp.status_code == 404:
            raise ValueError("Image endpoint not found — is this base URL image-capable?")
        if not resp.ok:
            try:
                detail = resp.json()
                msg = str(detail.get("error", {}).get("message", detail))[:300]
            except Exception:
                msg = resp.text[:300]
            raise ValueError(f"Image provider error ({resp.status_code}): {msg}")
        try:
            payload = resp.json()
        except Exception as e:
            raise ValueError(f"Image provider returned invalid JSON: {e}")
        return self._decode_image_payload(payload)


class StabilityProvider:
    """Thin Stability v2beta wrapper: sd3 generate, image passed through
    when a reference is supplied."""

    API_ROOT = "https://api.stability.ai"

    def __init__(self, api_key: str, model: str):
        self.api_key = (api_key or "").strip()
        self.model = (model or "").strip() or "sd3.5-large"

    def generate(self, prompt: str,
                 reference_bytes: Optional[bytes] = None) -> GeneratedImage:
        import requests

        if not self.api_key:
            raise ValueError("Stability API key is not configured (Settings → Image Generation)")
        if not (prompt or "").strip():
            raise ValueError("Prompt is required")
        url = f"{self.API_ROOT}/v2beta/stable-image/generate/sd3"
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "image/*"}
        files: Dict[str, Any] = {}
        form: Dict[str, Any] = {"prompt": prompt, "output_format": "png", "model": self.model}
        if reference_bytes:
            files["image"] = ("reference.png", io.BytesIO(reference_bytes), "image/png")
            form["mode"] = "image-to-image"
            form["strength"] = "0.7"
        try:
            if files:
                resp = requests.post(url, headers=headers, files=files, data=form, timeout=120)
            else:
                resp = requests.post(url, headers=headers, files={}, data=form, timeout=120)
        except Exception as e:
            raise ValueError(f"Stability request failed: {e}")
        if resp.status_code in (401, 403):
            raise ValueError("Stability rejected the API key (401/403)")
        if not resp.ok:
            raise ValueError(f"Stability error ({resp.status_code}): {resp.text[:300]}")
        ctype = resp.headers.get("Content-Type", "image/png")
        return GeneratedImage(data=resp.content, mime_type=ctype)


class FalProvider:
    """Thin FAL queue wrapper: submit → poll → download. The configured
    model must accept `prompt` (+ optional `image_url` for references)."""

    def __init__(self, api_key: str, model: str):
        self.api_key = (api_key or "").strip()
        self.model = (model or "").strip()

    def generate(self, prompt: str,
                 reference_bytes: Optional[bytes] = None) -> GeneratedImage:
        import requests

        if not self.api_key:
            raise ValueError("FAL API key is not configured (Settings → Image Generation)")
        if not self.model:
            raise ValueError("FAL model is not configured (Settings → Image Generation)")
        if not (prompt or "").strip():
            raise ValueError("Prompt is required")
        headers = {"Authorization": f"Key {self.api_key}", "Content-Type": "application/json"}
        payload: Dict[str, Any] = {"prompt": prompt}
        if reference_bytes:
            b64 = base64.b64encode(reference_bytes).decode("ascii")
            payload["image_url"] = f"data:image/png;base64,{b64}"
        try:
            sub = requests.post(f"https://queue.fal.run/{self.model}",
                                headers=headers, json=payload, timeout=30)
        except Exception as e:
            raise ValueError(f"FAL submit failed: {e}")
        if sub.status_code in (401, 403):
            raise ValueError("FAL rejected the API key (401/403)")
        if not sub.ok:
            raise ValueError(f"FAL submit error ({sub.status_code}): {sub.text[:300]}")
        try:
            request_id = sub.json().get("request_id")
        except Exception:
            request_id = None
        if not request_id:
            raise ValueError("FAL did not return a request_id")
        deadline = time.time() + 180
        result_url: Optional[str] = None
        while time.time() < deadline:
            try:
                st = requests.get(f"https://queue.fal.run/{self.model}/requests/{request_id}/status",
                                  headers={"Authorization": f"Key {self.api_key}"}, timeout=30)
            except Exception as e:
                raise ValueError(f"FAL status check failed: {e}")
            if not st.ok:
                raise ValueError(f"FAL status error ({st.status_code}): {st.text[:300]}")
            body = st.json()
            status = body.get("status")
            if status == "COMPLETED":
                result_url = body.get("response_url") or (
                    f"https://queue.fal.run/{self.model}/requests/{request_id}")
                break
            if status == "FAILED":
                raise ValueError(f"FAL generation failed: {str(body)[:300]}")
            time.sleep(2)
        if not result_url:
            raise ValueError("FAL generation timed out")
        try:
            res = requests.get(result_url, headers={"Authorization": f"Key {self.api_key}"},
                               timeout=60)
            res.raise_for_status()
            out = res.json()
        except Exception as e:
            raise ValueError(f"FAL result fetch failed: {e}")
        images = out.get("images") or out.get("data", {}).get("images") or []
        if not images:
            raise ValueError("FAL returned no images")
        img_url = images[0].get("url") if isinstance(images[0], dict) else None
        if not img_url:
            raise ValueError("FAL returned an image without a url")
        try:
            import requests as _rq
            dl = _rq.get(img_url, timeout=120)
            dl.raise_for_status()
            return GeneratedImage(data=dl.content,
                                  mime_type=dl.headers.get("Content-Type", "image/png"))
        except Exception as e:
            raise ValueError(f"Could not download FAL image: {e}")


class ComfyUIBundle:
    """One operation slot: a user-owned workflow plus the input mappings
    Margin needs for it. The edit bundle additionally carries the LoadImage
    input mapping (required — an edit workflow without one cannot accept
    the image Margin is supposed to send). Either bundle may carry an
    optional seed mapping; when present, Margin rolls a fresh 32-bit seed
    per run and overlays it on the submitted copy."""

    def __init__(self, workflow: Dict[str, Any], prompt_map: Dict[str, str],
                 image_map: Optional[Dict[str, str]] = None,
                 seed_map: Optional[Dict[str, str]] = None):
        self.workflow = workflow
        self.prompt_map = prompt_map
        self.image_map = image_map
        self.seed_map = seed_map


class ComfyUIProvider:
    """Client of the user's own ComfyUI instance.

    Two fixed slots mirror the two operations: Generate runs the text
    bundle, Regenerate runs the edit bundle (upload the reference, inject
    the server filename, run). One shared execution pipeline underneath —
    only bundle selection differs. Saved workflows are immutable
    configuration: every generation operates on a deep copy.
    """

    def __init__(self, base_url: str, text: Optional[ComfyUIBundle] = None,
                 edit: Optional[ComfyUIBundle] = None):
        self.base_url = (base_url or "").rstrip("/")
        self.text = text
        self.edit = edit

    def _describe_node(self, workflow: Dict[str, Any], node_id: Any) -> str:
        """Identify a failing node from the saved workflow for error messages."""
        node = workflow.get(str(node_id)) or {}
        title = (node.get("_meta") or {}).get("title")
        class_type = node.get("class_type", "?")
        label = f' "{title}"' if title else ""
        return f"node {node_id}{label} ({class_type})"

    def _upload_reference(self, reference_bytes: bytes) -> str:
        """Upload reference bytes to ComfyUI's input folder; return the
        server-assigned filename for workflow injection. Pure provider
        plumbing — callers never think about uploads. All failures are
        upstream (502): configuration was already validated."""
        import io
        import requests
        import uuid

        ext = _infer_upload_ext(reference_bytes)
        filename = f"margin-{uuid.uuid4().hex}.{ext}"
        mime = {"png": "image/png", "jpg": "image/jpeg",
                "webp": "image/webp"}[ext]
        try:
            resp = requests.post(
                f"{self.base_url}/upload/image",
                files={"image": (filename, io.BytesIO(reference_bytes), mime)},
                data={"overwrite": "true", "type": "input"},
                timeout=60,
            )
        except Exception as e:
            raise ValueError(f"Could not reach ComfyUI at {self.base_url}: {e}")
        if not resp.ok:
            raise ValueError(
                f"ComfyUI reference upload failed ({resp.status_code}): "
                f"{resp.text[:300]}")
        try:
            name = resp.json().get("name")
        except Exception:
            name = None
        if not name:
            raise ValueError("ComfyUI upload returned no filename")
        return str(name)

    def generate(self, prompt: str,
                 reference_bytes: Optional[bytes] = None) -> GeneratedImage:
        import copy

        if not self.base_url:
            raise ValueError("ComfyUI base URL is not configured (Settings → Images)")
        if not (prompt or "").strip():
            raise ValueError("Prompt is required")

        # Route by operation. Only the needed slot is validated, so a stale
        # edit workflow never breaks text generation and vice versa.
        if reference_bytes is not None:
            if self.edit is None:
                raise ValueError(
                    "Reference regeneration needs an edit workflow — import one "
                    "in Settings → Images (ComfyUI edit workflow)."
                )
            bundle = self.edit
            try:
                validate_comfy_prompt_map(bundle.workflow, bundle.prompt_map)
                validate_comfy_edit_image_map(bundle.workflow, bundle.image_map)
            except ValueError as e:
                raise ValueError(str(e))
            uploaded_name: Optional[str] = self._upload_reference(reference_bytes)
        else:
            if self.text is None:
                raise ValueError(
                    "Plain image generation needs a text-to-image workflow — "
                    "import one in Settings → Images (ComfyUI text workflow)."
                )
            bundle = self.text
            try:
                validate_comfy_prompt_map(bundle.workflow, bundle.prompt_map)
            except ValueError as e:
                raise ValueError(str(e))
            uploaded_name = None

        node_id = str(bundle.prompt_map["nodeId"])
        input_name = str(bundle.prompt_map["input"])
        # Deep copy: the saved workflow is immutable configuration.
        outgoing = copy.deepcopy(bundle.workflow)
        outgoing[node_id]["inputs"][input_name] = prompt
        if uploaded_name is not None and bundle.image_map is not None:
            ref_node = str(bundle.image_map["nodeId"])
            ref_input = str(bundle.image_map["input"])
            outgoing[ref_node]["inputs"][ref_input] = uploaded_name
        submitted_seed = self._roll_seed(bundle, outgoing)

        prompt_id = self._submit(outgoing, bundle.workflow)
        outputs = self._poll(prompt_id)
        result = self._download_first(outputs)
        result.seed = submitted_seed
        return result

    @staticmethod
    def _roll_seed(bundle: "ComfyUIBundle",
                   outgoing: Dict[str, Any]) -> Optional[int]:
        """Fresh 32-bit seed per mapped run, overlaid on the submitted copy
        only. Invariant: no seed mapping = the workflow's seed is never
        touched and None is reported."""
        import random

        if bundle.seed_map is None:
            return None
        try:
            validate_comfy_seed_map(bundle.workflow, bundle.seed_map)
        except ValueError as e:
            raise ValueError(str(e))
        seed = random.randint(0, 2**32 - 1)
        outgoing[str(bundle.seed_map["nodeId"])]["inputs"][
            str(bundle.seed_map["input"])] = seed
        return seed

    def _submit(self, outgoing: Dict[str, Any],
                workflow: Dict[str, Any]) -> str:
        """Queue the overlaid workflow copy; return the prompt id."""
        import requests

        try:
            sub = requests.post(f"{self.base_url}/prompt",
                                json={"prompt": outgoing}, timeout=30)
        except Exception as e:
            raise ValueError(f"Could not reach ComfyUI at {self.base_url}: {e}")
        if not sub.ok:
            raise ValueError(f"ComfyUI rejected the workflow ({sub.status_code}): {sub.text[:300]}")
        try:
            body = sub.json()
        except Exception:
            raise ValueError("ComfyUI returned invalid JSON for /prompt")
        node_errors = body.get("node_errors") or {}
        if node_errors:
            err_id, first = next(iter(node_errors.items()))
            detail = str(first.get("errors", first))[:300]
            raise ValueError(
                f"ComfyUI workflow error on {self._describe_node(workflow, err_id)}: "
                f"{detail}{_comfy_validation_hint(detail)}")
        prompt_id = body.get("prompt_id")
        if not prompt_id:
            raise ValueError("ComfyUI did not return a prompt_id")
        return str(prompt_id)

    def _poll(self, prompt_id: str) -> Dict[str, Any]:
        """Poll /history until completion; return the output map."""
        import requests

        deadline = time.time() + 180
        try:
            while time.time() < deadline:
                hist = requests.get(f"{self.base_url}/history/{prompt_id}", timeout=30)
                if not hist.ok:
                    raise ValueError(
                        f"ComfyUI history error ({hist.status_code}): {hist.text[:300]}")
                try:
                    entry = hist.json().get(prompt_id) or {}
                except Exception:
                    raise ValueError("ComfyUI returned invalid JSON for /history")
                status = entry.get("status") or {}
                if status.get("status_str") == "error":
                    msgs = str(status.get("messages", status))[:300]
                    raise ValueError(f"ComfyUI execution failed: {msgs}")
                if status.get("completed"):
                    return entry.get("outputs") or {}
                time.sleep(2)
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"ComfyUI poll failed: {e}")
        raise ValueError("ComfyUI generation timed out")

    def _download_first(self, outputs: Dict[str, Any]) -> GeneratedImage:
        """Download the first output image (v1 simplification)."""
        import requests

        image_ref = _first_comfy_image(outputs)
        if image_ref is None:
            raise ValueError("ComfyUI finished with no output images")
        try:
            dl = requests.get(f"{self.base_url}/view", params={
                "filename": image_ref["filename"],
                "subfolder": image_ref.get("subfolder", ""),
                "type": image_ref.get("type", "output"),
            }, timeout=120)
            dl.raise_for_status()
            return GeneratedImage(
                data=dl.content,
                mime_type=dl.headers.get("Content-Type", "image/png"),
            )
        except Exception as e:
            raise ValueError(f"Could not download ComfyUI image: {e}")


def _comfy_validation_hint(detail: str) -> str:
    # `not in []` means the server's model list for that loader is empty:
    # the file isn't installed on the instance Margin is talking to.
    if "not in []" in detail:
        return (" — that file isn't installed on the ComfyUI server at the "
                "configured base URL (its model list is empty). Check Settings → "
                "Images points at the same instance where the workflow runs, and "
                "that the file exists in its models folder.")
    return ""


def _infer_upload_ext(data: bytes) -> str:
    """Derive the upload extension from magic bytes, not the Markdown path.
    GIF is rejected: ComfyUI LoadImage inputs expect png/jpg/webp."""
    head = data[:12]
    if head.startswith(b"\x89PNG"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "webp"
    raise ValueError(
        "Reference image format is not supported by the ComfyUI upload "
        "(png, jpg, webp)")


def _first_comfy_image(outputs: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """First image across output nodes in workflow order (v1 simplification).
    Node ids are numeric strings — sort numerically so node 9 beats node 10."""
    def order(key: str) -> tuple:
        try:
            return (0, int(key))
        except ValueError:
            return (1, 0)

    for node_id in sorted(outputs.keys(), key=lambda k: (order(k), k)):
        node_out = outputs[node_id] or {}
        images = node_out.get("images") or []
        if images and isinstance(images[0], dict) and images[0].get("filename"):
            img = images[0]
            return {
                "filename": str(img["filename"]),
                "subfolder": str(img.get("subfolder", "")),
                "type": str(img.get("type", "output")),
            }
    return None


# Maximum workflow size Margin will store (API-format JSON is typically
# tens of KB; this bound keeps settings.json sane).
MAX_COMFY_WORKFLOW_NODES = 500
MAX_COMFY_WORKFLOW_BYTES = 2_000_000


def validate_comfy_workflow(workflow: Any) -> Dict[str, Any]:
    """Validate an imported ComfyUI workflow; return it typed on success."""
    if not isinstance(workflow, dict) or not workflow:
        raise ValueError("ComfyUI workflow must be a non-empty object")
    if "nodes" in workflow or "links" in workflow:
        raise ValueError(
            "That looks like ComfyUI graph format — export as API format "
            "(ComfyUI Manager/menu → Export (API)) and import that file instead."
        )
    if len(workflow) > MAX_COMFY_WORKFLOW_NODES:
        raise ValueError(
            f"ComfyUI workflow has {len(workflow)} nodes (max {MAX_COMFY_WORKFLOW_NODES})")
    import json as _json

    if len(_json.dumps(workflow)) > MAX_COMFY_WORKFLOW_BYTES:
        raise ValueError("ComfyUI workflow is too large to store (max ~2MB)")
    for node_id, node in workflow.items():
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            raise ValueError(
                f"ComfyUI workflow node {node_id!r} is not API format "
                "(expected {class_type, inputs})")
        if not node.get("class_type"):
            raise ValueError(f"ComfyUI workflow node {node_id!r} has no class_type")
    return workflow


def validate_comfy_prompt_map(workflow: Dict[str, Any], prompt_map: Any) -> None:
    """The saved mapping must still match the workflow (users evolve their
    workflows in ComfyUI independently — re-import when this 400s)."""
    if not isinstance(prompt_map, dict):
        raise ValueError(
            "ComfyUI prompt mapping is not configured — import an API-format "
            "workflow and pick the prompt input (Settings → Images)")
    node_id = str(prompt_map.get("nodeId", ""))
    input_name = str(prompt_map.get("input", ""))
    node = workflow.get(node_id)
    if node is None or not isinstance(node, dict):
        raise ValueError(
            "The saved ComfyUI prompt mapping no longer matches the workflow "
            f"(node {node_id!r} missing) — re-import the workflow.")
    inputs = node.get("inputs") or {}
    if input_name not in inputs:
        raise ValueError(
            "The saved ComfyUI prompt mapping no longer matches the workflow "
            f"(input {input_name!r} missing on node {node_id!r}) — re-import the workflow.")
    current = inputs[input_name]
    if current is not None and not isinstance(current, str):
        raise ValueError(
            f"ComfyUI prompt input {input_name!r} on node {node_id!r} is not a "
            "text field — pick a text input instead.")


def validate_comfy_edit_image_map(workflow: Dict[str, Any], ref_map: Any) -> None:
    """Validate the edit slot's image mapping. Required (unlike the prompt
    map which stands alone): an edit workflow without a LoadImage input
    cannot accept the image Margin is supposed to send."""
    if ref_map is None:
        raise ValueError(
            "ComfyUI edit workflow needs a reference image input — pick a "
            "LoadImage input (Settings → Images)")
    if not isinstance(ref_map, dict):
        raise ValueError(
            "ComfyUI reference mapping is invalid — re-pick the reference "
            "image input (Settings → Images)")
    node_id = str(ref_map.get("nodeId", ""))
    input_name = str(ref_map.get("input", ""))
    node = workflow.get(node_id)
    if node is None or not isinstance(node, dict):
        raise ValueError(
            "The saved ComfyUI reference mapping no longer matches the workflow "
            f"(node {node_id!r} missing) — re-import the workflow.")
    inputs = node.get("inputs") or {}
    if input_name not in inputs:
        raise ValueError(
            "The saved ComfyUI reference mapping no longer matches the workflow "
            f"(input {input_name!r} missing on node {node_id!r}) — re-import the workflow.")
    current = inputs[input_name]
    if current is not None and not isinstance(current, str):
        raise ValueError(
            f"ComfyUI reference input {input_name!r} on node {node_id!r} is not "
            "an image field — pick a LoadImage input instead.")


def _is_seed_value(value: Any) -> bool:
    # bool is a subclass of int — `add_noise: true` must never qualify.
    return isinstance(value, int) and not isinstance(value, bool)


def validate_comfy_seed_map(workflow: Dict[str, Any], seed_map: Any) -> None:
    """Validate the optional per-slot seed mapping. None means unmapped
    (workflow seed untouched). Present mappings follow the same stale-match
    discipline as prompt/image maps, so errors hit the existing 400 table."""
    if seed_map is None:
        return
    if not isinstance(seed_map, dict):
        raise ValueError(
            "ComfyUI seed mapping is invalid — re-pick the seed input "
            "(Settings → Images)")
    node_id = str(seed_map.get("nodeId", ""))
    input_name = str(seed_map.get("input", ""))
    node = workflow.get(node_id)
    if node is None or not isinstance(node, dict):
        raise ValueError(
            "The saved ComfyUI seed mapping no longer matches the workflow "
            f"(node {node_id!r} missing) — re-import the workflow.")
    inputs = node.get("inputs") or {}
    if input_name not in inputs:
        raise ValueError(
            "The saved ComfyUI seed mapping no longer matches the workflow "
            f"(input {input_name!r} missing on node {node_id!r}) — re-import the workflow.")
    current = inputs[input_name]
    if current is not None and not _is_seed_value(current):
        raise ValueError(
            f"ComfyUI seed input {input_name!r} on node {node_id!r} is not "
            "a seed field — pick an integer seed input instead.")


def extract_comfy_seed_candidates(workflow: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Rank integer inputs as seed-mapping candidates. Exact `seed` /
    `noise_seed` names rank highest; every other int is still listed so the
    user can confirm. Booleans, floats, strings, and connections never are."""

    def score(name: str) -> tuple:
        n = name.lower()
        if n in ("seed", "noise_seed"):
            return (100, "seed")
        if "seed" in n:
            return (80, "seed-like")
        return (10, "other-int")

    out: List[Dict[str, Any]] = []
    for node_id in sorted(workflow.keys()):
        node = workflow[node_id]
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type", ""))
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue
        for name, value in inputs.items():
            if not _is_seed_value(value):
                continue
            s, kind = score(str(name))
            out.append({
                "nodeId": str(node_id),
                "classType": class_type,
                "input": str(name),
                "preview": str(value),
                "kind": kind,
                "score": s,
            })
    out.sort(key=lambda c: (-c["score"], c["nodeId"], c["input"]))
    return out


def extract_comfy_image_candidates(workflow: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Rank image inputs as reference-mapping candidates. Same principle as
    text candidates: LoadImage-style inputs rank highest, everything else
    string-valued is still listed, connections never are, user confirms."""

    def score(class_type: str, name: str) -> tuple:
        n = name.lower()
        ct = class_type.lower()
        if "loadimage" in ct and n == "image":
            return (100, "reference-image")
        if "loadimage" in ct:
            return (80, "loader-input")
        if n == "image":
            return (70, "image")
        if n in ("upload", "filename", "file", "path"):
            return (50, "file-like")
        if "image" in n:
            return (40, "image-like")
        return (10, "other-text")

    out: List[Dict[str, Any]] = []
    for node_id in sorted(workflow.keys()):
        node = workflow[node_id]
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type", ""))
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue
        for name, value in inputs.items():
            if not isinstance(value, str):
                continue
            # The LoadImage `upload` widget is a mode selector
            # ("image"/"mask"), not an image field — never inject there.
            if class_type == "LoadImage" and str(name) == "upload":
                continue
            s, kind = score(class_type, str(name))
            preview = value if len(value) <= 80 else value[:77] + "..."
            out.append({
                "nodeId": str(node_id),
                "classType": class_type,
                "input": str(name),
                "preview": preview,
                "kind": kind,
                "score": s,
            })
    out.sort(key=lambda c: (-c["score"], c["nodeId"], c["input"]))
    return out


def extract_comfy_text_candidates(workflow: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Rank string inputs as prompt-mapping candidates. Margin does not
    understand the graph — CLIPTextEncode/text/prompt names rank highest,
    every other string input is still listed. The user always confirms."""

    def score(class_type: str, name: str) -> tuple:
        n = name.lower()
        if class_type == "CLIPTextEncode" and name == "text":
            return (100, "positive-prompt")
        if "positive" in n and "prompt" in n or n in ("positive", "pos_prompt"):
            return (80, "positive-prompt")
        if "prompt" in n:
            return (75, "prompt-like")
        if n == "text":
            return (70, "text")
        if "text" in n or "caption" in n:
            return (60, "text-like")
        return (10, "other-text")

    out: List[Dict[str, Any]] = []
    for node_id in sorted(workflow.keys()):
        node = workflow[node_id]
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type", ""))
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue
        for name, value in inputs.items():
            if not isinstance(value, str):
                continue
            s, kind = score(class_type, str(name))
            preview = value if len(value) <= 80 else value[:77] + "..."
            out.append({
                "nodeId": str(node_id),
                "classType": class_type,
                "input": str(name),
                "preview": preview,
                "kind": kind,
                "score": s,
            })
    out.sort(key=lambda c: (-c["score"], c["nodeId"], c["input"]))
    return out


def _comfy_text_bundle(settings: Dict[str, Any]) -> Optional[ComfyUIBundle]:
    """Presence-check the text slot. Deep validation happens in generate()
    for the needed slot only, so a stale edit workflow never breaks text
    generation and vice versa."""
    workflow = settings.get("image_comfy_text_workflow")
    prompt_map = settings.get("image_comfy_text_prompt_map")
    if not isinstance(workflow, dict) or not workflow:
        return None
    if not isinstance(prompt_map, dict):
        return None
    seed_map = settings.get("image_comfy_text_seed_map")
    return ComfyUIBundle(workflow=workflow, prompt_map=prompt_map,
                         seed_map=seed_map if isinstance(seed_map, dict) else None)


def _comfy_edit_bundle(settings: Dict[str, Any]) -> Optional[ComfyUIBundle]:
    workflow = settings.get("image_comfy_edit_workflow")
    prompt_map = settings.get("image_comfy_edit_prompt_map")
    image_map = settings.get("image_comfy_edit_image_map")
    if not isinstance(workflow, dict) or not workflow:
        return None
    if not isinstance(prompt_map, dict):
        return None
    if not isinstance(image_map, dict):
        return None
    seed_map = settings.get("image_comfy_edit_seed_map")
    return ComfyUIBundle(workflow=workflow, prompt_map=prompt_map,
                         image_map=image_map,
                         seed_map=seed_map if isinstance(seed_map, dict) else None)


def get_image_provider(settings: Dict[str, Any]) -> ImageProvider:
    name = str(settings.get("image_provider") or "openai-compatible").strip().lower()
    if name in ("openai-compatible", "openai", "lmstudio", "local"):
        return OpenAICompatibleProvider(
            base_url=_settings_get(settings, "image_base_url"),
            api_key=_settings_get(settings, "image_api_key"),
            model=_settings_get(settings, "image_model"),
        )
    if name == "stability":
        return StabilityProvider(
            api_key=_settings_get(settings, "image_api_key"),
            model=_settings_get(settings, "image_model"),
        )
    if name == "fal":
        return FalProvider(
            api_key=_settings_get(settings, "image_api_key"),
            model=_settings_get(settings, "image_model"),
        )
    if name == "comfyui":
        text = _comfy_text_bundle(settings)
        edit = _comfy_edit_bundle(settings)
        if text is None and edit is None:
            raise ValueError(
                "No ComfyUI workflow is configured — import a text-to-image "
                "and/or edit workflow in Settings → Images.")
        return ComfyUIProvider(
            base_url=_settings_get(settings, "image_base_url"),
            text=text,
            edit=edit,
        )
    raise ValueError(
        f"Unknown image provider: {name!r} (expected one of: {', '.join(SELECTABLE_PROVIDERS)})"
    )
