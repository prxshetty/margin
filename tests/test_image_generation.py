"""Image generation: storage, validation matrix, styles, providers."""
import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from api.services.file_storage import FileStorageService
from api.services import image_providers as ip

PNG = bytes.fromhex("89504e470d0a1a0a") + b"\x00" * 64

COMFY_WF = {
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "old prompt", "clip": ["4", 1]}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "negative", "clip": ["4", 1]}},
    "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "out"}},
}

COMFY_WF_EDIT = {
    **COMFY_WF,
    "13": {"class_type": "SamplerCustom",
           "inputs": {"noise_seed": 0, "cfg": 1, "add_noise": True,
                      "steps": 2.5, "model": ["20", 0]}},
    "30": {"class_type": "LoadImage", "inputs": {"image": "old.png", "upload": "image"}},
}

EDIT_IMAGE_MAP = {"nodeId": "30", "input": "image"}
EDIT_SEED_MAP = {"nodeId": "13", "input": "noise_seed"}
PROMPT_MAP = {"nodeId": "6", "input": "text"}


def _text_settings(**over):
    s = {
        "image_provider": "comfyui",
        "image_base_url": "http://127.0.0.1:8188",
        "image_comfy_text_workflow": COMFY_WF,
        "image_comfy_text_prompt_map": dict(PROMPT_MAP),
    }
    s.update(over)
    return s


def _edit_settings(**over):
    s = {
        "image_comfy_edit_workflow": COMFY_WF_EDIT,
        "image_comfy_edit_prompt_map": dict(PROMPT_MAP),
        "image_comfy_edit_image_map": dict(EDIT_IMAGE_MAP),
    }
    s.update(over)
    return s


def _storage():
    tmp = tempfile.mkdtemp()
    svc = FileStorageService(base_dir=tmp)
    svc.workspace_dir = Path(tmp)
    return svc


class TestGeneratedStorage(unittest.TestCase):
    def test_opaque_names_in_generated_dir(self):
        svc = _storage()
        r = svc.save_generated_bytes(PNG, "image/png")
        self.assertTrue(r["path"].startswith("assets/generated/"))
        self.assertRegex(r["path"], r"^assets/generated/[0-9a-f]{32}\.png$")
        full, mime = svc.read_media(r["path"])
        self.assertTrue(full.exists())
        self.assertEqual(mime, "image/png")

    def test_never_overwrites(self):
        svc = _storage()
        paths = {svc.save_generated_bytes(PNG)["path"] for _ in range(5)}
        self.assertEqual(len(paths), 5)

    def test_invalid_bytes_rejected(self):
        svc = _storage()
        with self.assertRaises(ValueError):
            svc.save_generated_bytes(b"not an image")

    def test_generated_served_through_media_boundary(self):
        svc = _storage()
        r = svc.save_generated_bytes(PNG)
        full, _ = svc.read_media(r["path"])
        self.assertTrue(full.exists())
        with self.assertRaises((ValueError, FileNotFoundError)):
            svc.read_media("../settings.json")


class TestStyles(unittest.TestCase):
    def test_default_none_when_unset(self):
        self.assertIsNone(ip.resolve_style_prompt(None, {}))

    def test_builtin_case_insensitive(self):
        self.assertIsNotNone(ip.resolve_style_prompt("cinematic", {}))

    def test_custom_style_resolves(self):
        s = {"image_custom_styles": [{"name": "Fantasy", "prompt": "dragons"}]}
        self.assertEqual(ip.resolve_style_prompt("fantasy", s), "dragons")

    def test_unknown_style_raises(self):
        with self.assertRaises(ValueError):
            ip.resolve_style_prompt("Nope", {})

    def test_compose_appends_style(self):
        self.assertEqual(ip.compose_final_prompt("cabin", None), "cabin")
        self.assertIn("Style:", ip.compose_final_prompt("cabin", "moody"))


class FakeProvider:
    def __init__(self, *a, **k):
        self.calls = []

    def generate(self, prompt, reference_bytes=None):
        self.calls.append((prompt, reference_bytes))
        return ip.GeneratedImage(data=PNG, mime_type="image/png")


def _client():
    from api.main import app

    return TestClient(app)


def _patched_post(client, svc, payload, provider=None):
    import api.routers.images as images_router

    provider = provider or FakeProvider()
    with patch.object(images_router, "storage", svc):
        with patch.object(images_router, "get_image_provider", return_value=provider):
            return client.post("/api/images/generate", json=payload)


class TestGenerateEndpoint(unittest.TestCase):
    def test_empty_prompt_no_reference_400(self):
        svc = _storage()
        c = _client()
        import api.routers.images as images_router

        with patch.object(images_router, "storage", svc):
            r = c.post("/api/images/generate", json={"prompt": ""})
        self.assertEqual(r.status_code, 400)

    def test_prompt_no_reference_success(self):
        svc = _storage()
        c = _client()
        r = _patched_post(c, svc, {"prompt": "a cabin"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["path"].startswith("assets/generated/"))

    def test_empty_prompt_with_reference_regenerates(self):
        svc = _storage()
        ref = svc.save_generated_bytes(PNG)["path"]
        c = _client()
        seen = {}

        class P(FakeProvider):
            def generate(self, prompt, reference_bytes=None):
                seen["prompt"] = prompt
                seen["ref"] = reference_bytes
                return ip.GeneratedImage(data=PNG, mime_type="image/png")

        r = _patched_post(c, svc, {"prompt": "", "reference_path": ref}, P())
        self.assertEqual(r.status_code, 200, r.text)
        # Style suffix depends on ambient user settings — assert the regen
        # prefix only.
        self.assertTrue(seen["prompt"].startswith(ip.EMPTY_REGEN_PROMPT))
        self.assertIsNotNone(seen["ref"])

    def test_unknown_style_400(self):
        svc = _storage()
        c = _client()
        import api.routers.images as images_router

        with patch.object(images_router, "storage", svc):
            r = c.post("/api/images/generate",
                       json={"prompt": "x", "style_name": "Nope"})
        self.assertEqual(r.status_code, 400)

    def test_invalid_reference_400(self):
        svc = _storage()
        c = _client()
        import api.routers.images as images_router

        with patch.object(images_router, "storage", svc):
            r = c.post("/api/images/generate",
                       json={"prompt": "x", "reference_path": "../settings.json"})
            self.assertEqual(r.status_code, 400)
            r = c.post("/api/images/generate",
                       json={"prompt": "x", "reference_path": "assets/missing.png"})
            self.assertEqual(r.status_code, 400)

    def test_backend_never_touches_markdown(self):
        svc = _storage()
        c = _client()
        r = _patched_post(c, svc, {"prompt": "x"})
        body = r.json()
        self.assertIn("path", body)
        self.assertNotIn("markdown", body)


class TestProviders(unittest.TestCase):
    def test_unknown_provider_error(self):
        with self.assertRaises(ValueError):
            ip.get_image_provider({"image_provider": "nope"})

    def test_comfyui_unconfigured(self):
        with self.assertRaisesRegex(ValueError, "No ComfyUI workflow"):
            ip.get_image_provider({"image_provider": "comfyui"})

    def test_comfyui_dual_slots(self):
        p = ip.get_image_provider({**_text_settings(), **_edit_settings()})
        self.assertIsInstance(p, ip.ComfyUIProvider)
        self.assertIsNotNone(p.text)
        self.assertIsNotNone(p.edit)

    def test_comfyui_text_only_provider(self):
        p = ip.get_image_provider(_text_settings())
        self.assertIsNotNone(p.text)
        self.assertIsNone(p.edit)

    def test_comfyui_missing_slot_routing(self):
        text_only = ip.get_image_provider(_text_settings())
        with self.assertRaisesRegex(ValueError, "needs an edit workflow"):
            text_only.generate("x", PNG)
        edit_only = ip.get_image_provider({
            "image_provider": "comfyui",
            "image_base_url": "http://127.0.0.1:8188",
            **_edit_settings(),
        })
        with self.assertRaisesRegex(ValueError, "needs a text-to-image workflow"):
            edit_only.generate("x")

    def test_openai_missing_config(self):
        p = ip.OpenAICompatibleProvider(base_url="", api_key="", model="")
        with self.assertRaises(ValueError):
            p.generate("x")

    def test_openai_decodes_b64(self):
        p = ip.OpenAICompatibleProvider(base_url="http://x", api_key="", model="m")
        img = p._decode_image_payload(
            {"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
        self.assertEqual(img.data, PNG)

    def test_openai_rejects_empty_data(self):
        p = ip.OpenAICompatibleProvider(base_url="http://x", api_key="", model="m")
        with self.assertRaises(ValueError):
            p._decode_image_payload({"data": []})


class TestComfyWorkflow(unittest.TestCase):
    def test_graph_format_rejected_with_guidance(self):
        with self.assertRaisesRegex(ValueError, "API format"):
            ip.validate_comfy_workflow({"nodes": [], "links": []})

    def test_empty_and_malformed_rejected(self):
        with self.assertRaises(ValueError):
            ip.validate_comfy_workflow({})
        with self.assertRaises(ValueError):
            ip.validate_comfy_workflow({"6": {"nope": True}})

    def test_candidates_rank_clip_first(self):
        cands = ip.extract_comfy_text_candidates(COMFY_WF)
        self.assertGreaterEqual(len(cands), 2)
        self.assertEqual(cands[0]["nodeId"], "6")
        self.assertEqual(cands[0]["kind"], "positive-prompt")
        self.assertEqual(cands[0]["score"], 100)
        # Non-text connections (lists) are never candidates.
        for c in cands:
            self.assertNotEqual(c["input"], "clip")

    def test_stale_map_detected(self):
        with self.assertRaisesRegex(ValueError, "no longer matches"):
            ip.validate_comfy_prompt_map(COMFY_WF, {"nodeId": "99", "input": "text"})
        with self.assertRaisesRegex(ValueError, "no longer matches"):
            ip.validate_comfy_prompt_map(COMFY_WF, {"nodeId": "6", "input": "missing"})
        with self.assertRaisesRegex(ValueError, "not a text field"):
            ip.validate_comfy_prompt_map(COMFY_WF, {"nodeId": "6", "input": "clip"})
        # Valid map passes silently.
        ip.validate_comfy_prompt_map(COMFY_WF, {"nodeId": "6", "input": "text"})


class _Resp:
    def __init__(self, payload=None, content=b"", ok=True, status=200,
                 content_type="image/png"):
        self._payload = payload
        self.content = content
        self.ok = ok
        self.status_code = status
        self.headers = {"Content-Type": content_type}
        self.text = "" if payload is not None else content[:100].decode("utf-8", "replace")

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload

    def raise_for_status(self):
        if not self.ok:
            raise ValueError(f"http {self.status_code}")


def _comfy_history(outputs):
    return {"pid-1": {"status": {"status_str": "success", "completed": True,
                                 "messages": []},
                      "outputs": outputs}}


class TestComfyProvider(unittest.TestCase):
    def _text_bundle(self, workflow=None):
        import copy

        return ip.ComfyUIBundle(
            workflow=copy.deepcopy(workflow or COMFY_WF),
            prompt_map=dict(PROMPT_MAP))

    def _edit_bundle(self):
        import copy

        return ip.ComfyUIBundle(
            workflow=copy.deepcopy(COMFY_WF_EDIT),
            prompt_map=dict(PROMPT_MAP),
            image_map=dict(EDIT_IMAGE_MAP))

    def _provider(self, **kw):
        args = {"base_url": "http://127.0.0.1:8188",
                "text": self._text_bundle()}
        args.update(kw)
        return ip.ComfyUIProvider(**args)

    def test_happy_path_uses_first_image_and_preserves_saved_workflow(self):
        text = self._text_bundle()
        saved = text.workflow
        p = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188", text=text)
        sent = {}

        def fake_post(url, **kw):
            if url.endswith("/prompt"):
                sent.update(kw["json"]["prompt"])
                return _Resp({"prompt_id": "pid-1", "node_errors": {}})
            raise AssertionError(url)

        def fake_get(url, **kw):
            if "/history/" in url:
                return _Resp(_comfy_history({
                    "9": {"images": [{"filename": "a.png", "subfolder": "",
                                      "type": "output"}]},
                    "10": {"images": [{"filename": "b.png", "subfolder": "",
                                       "type": "output"}]},
                }))
            if url.endswith("/view"):
                self.assertEqual(kw["params"]["filename"], "a.png")
                return _Resp(content=PNG)
            raise AssertionError(url)

        with patch("requests.post", side_effect=fake_post), \
                patch("requests.get", side_effect=fake_get):
            img = p.generate("a golden retriever")
        self.assertEqual(img.data, PNG)
        # Prompt overlaid on the submitted copy...
        self.assertEqual(sent["6"]["inputs"]["text"], "a golden retriever")
        # ...while the saved workflow is immutable configuration.
        self.assertEqual(saved, COMFY_WF)

    def test_node_errors_name_node_and_hint_missing_model(self):
        import copy

        wf = copy.deepcopy(COMFY_WF)
        wf["6"]["_meta"] = {"title": "CLIP Text Encode (Prompt)"}
        text = ip.ComfyUIBundle(workflow=wf, prompt_map=dict(PROMPT_MAP))
        p = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188", text=text)
        err = {"type": "value_not_in_list", "message": "Value not in list",
               "details": "unet_name: 'z_image_turbo_bf16.safetensors' not in []"}
        with patch("requests.post",
                   return_value=_Resp({"prompt_id": "x", "node_errors": {"6": {"errors": [err]}}})):
            with self.assertRaisesRegex(ValueError, "node 6") as ctx:
                p.generate("x")
        msg = str(ctx.exception)
        self.assertIn("CLIP Text Encode (Prompt)", msg)
        self.assertIn("isn't installed", msg)
        with patch("requests.post",
                   return_value=_Resp({"prompt_id": "pid-1", "node_errors": {}})), \
                patch("requests.get", return_value=_Resp(_comfy_history({}))):
            with self.assertRaisesRegex(ValueError, "no output images"):
                p.generate("x")

    def test_reference_without_edit_slot_400s_at_endpoint(self):
        import api.routers.images as images_router

        svc = _storage()
        ref = svc.save_generated_bytes(PNG)["path"]
        c = _client()
        with patch.object(images_router, "storage", svc):
            with patch.object(images_router, "get_image_provider",
                              return_value=self._provider()):
                r = c.post("/api/images/generate",
                           json={"prompt": "edit", "reference_path": ref})
        self.assertEqual(r.status_code, 400)
        self.assertIn("edit workflow", r.json()["detail"])

    def test_plain_generate_without_text_slot_400s_at_endpoint(self):
        import api.routers.images as images_router

        svc = _storage()
        c = _client()
        edit_only = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188",
                                       edit=self._edit_bundle())
        with patch.object(images_router, "storage", svc):
            with patch.object(images_router, "get_image_provider",
                              return_value=edit_only):
                r = c.post("/api/images/generate", json={"prompt": "x"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("text-to-image workflow", r.json()["detail"])

    def test_stale_edit_slot_does_not_break_text_generation(self):
        import copy

        stale_edit = ip.ComfyUIBundle(
            workflow=copy.deepcopy(COMFY_WF_EDIT),
            prompt_map=dict(PROMPT_MAP),
            image_map={"nodeId": "99", "input": "image"})
        p = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188",
                               text=self._text_bundle(), edit=stale_edit)
        with patch("requests.post",
                   return_value=_Resp({"prompt_id": "pid-1", "node_errors": {}})), \
                patch("requests.get") as mock_get:
            mock_get.side_effect = lambda url, **kw: (
                _Resp(_comfy_history({"9": {"images": [{"filename": "a.png",
                                                        "subfolder": "", "type": "output"}]}}))
                if "/history/" in url else _Resp(content=PNG))
            img = p.generate("plain text gen")
        self.assertEqual(img.data, PNG)

    def test_reference_upload_inject_and_saved_workflow_immutable(self):
        edit = self._edit_bundle()
        saved = edit.workflow
        p = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188",
                               text=self._text_bundle(), edit=edit)
        sent_prompt = {}
        sent_files = {}

        def fake_post(url, **kw):
            if url.endswith("/upload/image"):
                sent_files.update(kw.get("files", {}))
                self.assertEqual(kw["data"], {"overwrite": "true", "type": "input"})
                return _Resp({"name": "margin-abc123.png", "subfolder": "",
                              "type": "input"})
            if url.endswith("/prompt"):
                sent_prompt.update(kw["json"]["prompt"])
                return _Resp({"prompt_id": "pid-1", "node_errors": {}})
            raise AssertionError(url)

        def fake_get(url, **kw):
            if "/history/" in url:
                return _Resp(_comfy_history({
                    "9": {"images": [{"filename": "out.png", "subfolder": "",
                                      "type": "output"}]},
                }))
            if url.endswith("/view"):
                return _Resp(content=PNG)
            raise AssertionError(url)

        with patch("requests.post", side_effect=fake_post), \
                patch("requests.get", side_effect=fake_get):
            img = p.generate("make it blue", PNG)
        self.assertEqual(img.data, PNG)
        # Upload used a unique margin- filename with inferred png type...
        fname, bio, mime = sent_files["image"]
        self.assertTrue(fname.startswith("margin-") and fname.endswith(".png"))
        self.assertEqual(mime, "image/png")
        self.assertEqual(bio.read(), PNG)
        # ...prompt overlaid and server filename injected on the copy...
        self.assertEqual(sent_prompt["6"]["inputs"]["text"], "make it blue")
        self.assertEqual(sent_prompt["30"]["inputs"]["image"], "margin-abc123.png")
        self.assertEqual(sent_prompt["30"]["inputs"]["upload"], "image")
        # ...while the saved workflow still holds the user's original values.
        self.assertEqual(saved, COMFY_WF_EDIT)
        self.assertEqual(p.edit.workflow, COMFY_WF_EDIT)
        self.assertEqual(p.text.workflow, COMFY_WF)

    def test_reference_regeneration_200_at_endpoint_with_map(self):
        import api.routers.images as images_router

        edit = self._edit_bundle()
        saved = edit.workflow
        provider = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188",
                                      text=self._text_bundle(), edit=edit)
        svc = _storage()
        ref = svc.save_generated_bytes(PNG)["path"]
        c = _client()
        with patch("requests.post") as mock_post, \
                patch("requests.get") as mock_get, \
                patch.object(images_router, "storage", svc), \
                patch.object(images_router, "get_image_provider", return_value=provider):
            mock_post.side_effect = [
                _Resp({"name": "margin-x.png", "subfolder": "", "type": "input"}),
                _Resp({"prompt_id": "pid-1", "node_errors": {}}),
            ]

            def route_get(url, **kw):
                if "/history/" in url:
                    return _Resp(_comfy_history({
                        "9": {"images": [{"filename": "o.png", "subfolder": "",
                                          "type": "output"}]},
                    }))
                return _Resp(content=PNG)

            mock_get.side_effect = route_get
            r = c.post("/api/images/generate",
                       json={"prompt": "edit", "reference_path": ref})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["path"].startswith("assets/generated/"))
        self.assertEqual(saved, COMFY_WF_EDIT)

    def test_upload_ext_inferred_from_bytes(self):
        self.assertEqual(ip._infer_upload_ext(PNG), "png")
        self.assertEqual(ip._infer_upload_ext(bytes.fromhex("ffd8ffe0") + b"\x00" * 16), "jpg")
        self.assertEqual(ip._infer_upload_ext(b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 16), "webp")
        with self.assertRaisesRegex(ValueError, "not supported"):
            ip._infer_upload_ext(b"GIF89a" + b"\x00" * 16)

    def test_image_candidates_rank_loadimage_first(self):
        cands = ip.extract_comfy_image_candidates(COMFY_WF_EDIT)
        self.assertEqual(cands[0]["nodeId"], "30")
        self.assertEqual(cands[0]["input"], "image")
        self.assertEqual(cands[0]["kind"], "reference-image")
        # The LoadImage mode selector is never an injection target.
        self.assertFalse(any(c["nodeId"] == "30" and c["input"] == "upload" for c in cands))
        # Connections (lists) are never candidates.
        self.assertFalse(any(c["input"] == "clip" for c in cands))

    def test_stale_reference_map_detected(self):
        # The edit image mapping is required: absence is a config error.
        with self.assertRaisesRegex(ValueError, "needs a reference image input"):
            ip.validate_comfy_edit_image_map(COMFY_WF_EDIT, None)
        ip.validate_comfy_edit_image_map(COMFY_WF_EDIT, dict(EDIT_IMAGE_MAP))
        with self.assertRaisesRegex(ValueError, "no longer matches"):
            ip.validate_comfy_edit_image_map(COMFY_WF_EDIT, {"nodeId": "99", "input": "image"})
        with self.assertRaisesRegex(ValueError, "no longer matches"):
            ip.validate_comfy_edit_image_map(COMFY_WF_EDIT, {"nodeId": "30", "input": "missing"})
        with self.assertRaisesRegex(ValueError, "not an image field"):
            ip.validate_comfy_edit_image_map(COMFY_WF_EDIT, {"nodeId": "6", "input": "clip"})


class TestComfySeedMap(unittest.TestCase):
    def test_absent_is_valid(self):
        ip.validate_comfy_seed_map(COMFY_WF_EDIT, None)
        ip.validate_comfy_seed_map(COMFY_WF_EDIT, dict(EDIT_SEED_MAP))

    def test_stale_and_wrong_types_rejected(self):
        with self.assertRaisesRegex(ValueError, "no longer matches"):
            ip.validate_comfy_seed_map(COMFY_WF_EDIT, {"nodeId": "99", "input": "noise_seed"})
        with self.assertRaisesRegex(ValueError, "no longer matches"):
            ip.validate_comfy_seed_map(COMFY_WF_EDIT, {"nodeId": "13", "input": "missing"})
        # bool is not a seed, even though bool ⊂ int.
        with self.assertRaisesRegex(ValueError, "not a seed field"):
            ip.validate_comfy_seed_map(COMFY_WF_EDIT, {"nodeId": "13", "input": "add_noise"})
        with self.assertRaisesRegex(ValueError, "not a seed field"):
            ip.validate_comfy_seed_map(COMFY_WF_EDIT, {"nodeId": "13", "input": "steps"})
        with self.assertRaisesRegex(ValueError, "not a seed field"):
            ip.validate_comfy_seed_map(COMFY_WF_EDIT, {"nodeId": "13", "input": "model"})
        with self.assertRaisesRegex(ValueError, "not a seed field"):
            ip.validate_comfy_seed_map(COMFY_WF_EDIT, {"nodeId": "6", "input": "text"})
        with self.assertRaisesRegex(ValueError, "seed mapping is invalid"):
            ip.validate_comfy_seed_map(COMFY_WF_EDIT, "13.noise_seed")

    def test_seed_candidates_ranking(self):
        cands = ip.extract_comfy_seed_candidates(COMFY_WF_EDIT)
        self.assertEqual(cands[0]["nodeId"], "13")
        self.assertEqual(cands[0]["input"], "noise_seed")
        self.assertEqual(cands[0]["kind"], "seed")
        self.assertEqual(cands[0]["score"], 100)
        # bool/float/str/list inputs are never candidates.
        got = {(c["nodeId"], c["input"]) for c in cands}
        self.assertNotIn(("13", "add_noise"), got)
        self.assertNotIn(("13", "steps"), got)
        self.assertNotIn(("13", "model"), got)
        self.assertNotIn(("6", "text"), got)
        # Plain ints are still listed (low rank) for user confirmation.
        self.assertIn(("13", "cfg"), got)

    def test_seed_override_on_copy_only_and_reported(self):
        import copy

        saved = copy.deepcopy(COMFY_WF_EDIT)
        text = ip.ComfyUIBundle(workflow=saved, prompt_map=dict(PROMPT_MAP),
                                seed_map=dict(EDIT_SEED_MAP))
        p = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188", text=text)
        sent = {}

        def fake_post(url, **kw):
            sent.update(kw["json"]["prompt"])
            return _Resp({"prompt_id": "pid-1", "node_errors": {}})

        def fake_get(url, **kw):
            if "/history/" in url:
                return _Resp(_comfy_history({
                    "9": {"images": [{"filename": "a.png", "subfolder": "",
                                      "type": "output"}]},
                }))
            return _Resp(content=PNG)

        with patch("random.randint", return_value=1837291842), \
                patch("requests.post", side_effect=fake_post), \
                patch("requests.get", side_effect=fake_get):
            img = p.generate("seeded run")
        self.assertEqual(img.seed, 1837291842)
        self.assertEqual(sent["13"]["inputs"]["noise_seed"], 1837291842)
        self.assertEqual(sent["6"]["inputs"]["text"], "seeded run")
        # Saved workflow untouched — pinned 0 still there.
        self.assertEqual(saved["13"]["inputs"]["noise_seed"], 0)
        self.assertEqual(saved, COMFY_WF_EDIT)

    def test_seed_in_32_bit_range(self):
        import copy

        text = ip.ComfyUIBundle(workflow=copy.deepcopy(COMFY_WF_EDIT),
                                prompt_map=dict(PROMPT_MAP),
                                seed_map=dict(EDIT_SEED_MAP))
        p = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188", text=text)
        seen = []

        def fake_post(url, **kw):
            seen.append(kw["json"]["prompt"]["13"]["inputs"]["noise_seed"])
            return _Resp({"prompt_id": "pid-1", "node_errors": {}})

        def fake_get(url, **kw):
            if "/history/" in url:
                return _Resp(_comfy_history({
                    "9": {"images": [{"filename": "a.png", "subfolder": "",
                                      "type": "output"}]},
                }))
            return _Resp(content=PNG)

        with patch("requests.post", side_effect=fake_post), \
                patch("requests.get", side_effect=fake_get):
            for _ in range(3):
                p.generate("x")
        for s in seen:
            self.assertIsInstance(s, int)
            self.assertGreaterEqual(s, 0)
            self.assertLessEqual(s, 2**32 - 1)

    def test_unmapped_slot_leaves_seed_and_reports_none(self):
        import copy

        saved = copy.deepcopy(COMFY_WF)
        text = ip.ComfyUIBundle(workflow=saved, prompt_map=dict(PROMPT_MAP))
        p = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188", text=text)
        sent = {}

        def fake_post(url, **kw):
            sent.update(kw["json"]["prompt"])
            return _Resp({"prompt_id": "pid-1", "node_errors": {}})

        def fake_get(url, **kw):
            if "/history/" in url:
                return _Resp(_comfy_history({
                    "9": {"images": [{"filename": "a.png", "subfolder": "",
                                      "type": "output"}]},
                }))
            return _Resp(content=PNG)

        with patch("requests.post", side_effect=fake_post), \
                patch("requests.get", side_effect=fake_get):
            img = p.generate("plain")
        self.assertIsNone(img.seed)
        self.assertNotIn("13", sent)

    def test_stale_seed_map_400s_without_breaking_other_slot(self):
        import copy

        stale_text = ip.ComfyUIBundle(
            workflow=copy.deepcopy(COMFY_WF_EDIT),
            prompt_map=dict(PROMPT_MAP),
            seed_map={"nodeId": "99", "input": "noise_seed"})
        edit = ip.ComfyUIBundle(
            workflow=copy.deepcopy(COMFY_WF_EDIT),
            prompt_map=dict(PROMPT_MAP),
            image_map=dict(EDIT_IMAGE_MAP))
        p = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188",
                               text=stale_text, edit=edit)
        with patch("requests.post",
                   return_value=_Resp({"prompt_id": "pid-1", "node_errors": {}})), \
                patch("requests.get") as mock_get:
            mock_get.side_effect = lambda url, **kw: (
                _Resp(_comfy_history({"9": {"images": [{"filename": "a.png",
                                                        "subfolder": "", "type": "output"}]}}))
                if "/history/" in url else _Resp(content=PNG))
            with self.assertRaisesRegex(ValueError, "no longer matches"):
                p.generate("text path")
        # Edit path (no seed map here) still works.
        with patch("requests.post") as mock_post, \
                patch("requests.get") as mock_get:
            mock_post.side_effect = [
                _Resp({"name": "margin-x.png", "subfolder": "", "type": "input"}),
                _Resp({"prompt_id": "pid-1", "node_errors": {}}),
            ]

            def route_get(url, **kw):
                if "/history/" in url:
                    return _Resp(_comfy_history({
                        "9": {"images": [{"filename": "o.png", "subfolder": "",
                                          "type": "output"}]},
                    }))
                return _Resp(content=PNG)

            mock_get.side_effect = route_get
            img = p.generate("edit path", PNG)
        self.assertIsNone(img.seed)

    def test_endpoint_response_carries_seed(self):
        import copy
        import api.routers.images as images_router

        text = ip.ComfyUIBundle(workflow=copy.deepcopy(COMFY_WF_EDIT),
                                prompt_map=dict(PROMPT_MAP),
                                seed_map=dict(EDIT_SEED_MAP))
        provider = ip.ComfyUIProvider(base_url="http://127.0.0.1:8188", text=text)
        svc = _storage()
        c = _client()
        with patch("random.randint", return_value=42), \
                patch("requests.post",
                      return_value=_Resp({"prompt_id": "pid-1", "node_errors": {}})), \
                patch("requests.get") as mock_get, \
                patch.object(images_router, "storage", svc), \
                patch.object(images_router, "get_image_provider", return_value=provider):
            def route_get(url, **kw):
                if "/history/" in url:
                    return _Resp(_comfy_history({
                        "9": {"images": [{"filename": "o.png", "subfolder": "",
                                          "type": "output"}]},
                    }))
                return _Resp(content=PNG)

            mock_get.side_effect = route_get
            r = c.post("/api/images/generate", json={"prompt": "x"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["seed"], 42)
        self.assertTrue(r.json()["path"].startswith("assets/generated/"))

    def test_analyze_endpoint(self):
        c = _client()
        r = c.post("/api/images/comfy/analyze", json={"workflow": COMFY_WF_EDIT})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["node_count"], 6)
        self.assertEqual(body["candidates"][0]["nodeId"], "6")
        self.assertEqual(body["image_candidates"][0]["nodeId"], "30")
        self.assertEqual(body["image_candidates"][0]["input"], "image")
        self.assertEqual(body["seed_candidates"][0]["nodeId"], "13")
        self.assertEqual(body["seed_candidates"][0]["input"], "noise_seed")
        r = c.post("/api/images/comfy/analyze", json={"workflow": {"nodes": []}})
        self.assertEqual(r.status_code, 400)


class TestImageLogs(unittest.TestCase):
    def test_round_trip_and_cap(self):
        svc = _storage()
        self.assertEqual(svc.get_image_logs(), [])
        for i in range(105):
            svc.save_image_log({"timestamp": f"2026-01-01T00:00:{i:03d}+00:00",
                                "prompt": f"p{i}", "seed": i,
                                "path": f"assets/generated/{i}.png"})
        logs = svc.get_image_logs()
        self.assertEqual(len(logs), 100)
        self.assertEqual(logs[0]["prompt"], "p5")
        self.assertEqual(logs[-1]["prompt"], "p104")

    def test_generate_writes_log_entry(self):
        import api.routers.images as images_router

        svc = _storage()
        c = _client()
        with patch.object(images_router, "storage", svc):
            with patch.object(images_router, "get_image_provider",
                              return_value=FakeProvider()):
                r = c.post("/api/images/generate",
                           json={"prompt": "a cabin", "style_name": None})
        self.assertEqual(r.status_code, 200, r.text)
        logs = svc.get_image_logs()
        self.assertEqual(len(logs), 1)
        entry = logs[0]
        self.assertEqual(entry["prompt"], "a cabin")
        self.assertEqual(entry["path"], r.json()["path"])
        self.assertIn("timestamp", entry)
        # Provider comes from ambient settings (patched storage still reads
        # the global settings file) — assert presence, not a fixed value.
        self.assertTrue(entry["provider"])
        self.assertIsNone(entry["reference_path"])
        # ...and the logs endpoint serves it.
        with patch.object(images_router, "storage", svc):
            lr = c.get("/api/images/logs")
        self.assertEqual(lr.status_code, 200)
        self.assertEqual(len(lr.json()["logs"]), 1)

    def test_failed_generate_writes_nothing(self):
        import api.routers.images as images_router

        svc = _storage()
        c = _client()
        with patch.object(images_router, "storage", svc):
            r = c.post("/api/images/generate", json={"prompt": ""})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(svc.get_image_logs(), [])

    def test_reveal_opens_generated_folder(self):
        import api.routers.images as images_router

        svc = _storage()
        c = _client()
        opened = []
        with patch.object(images_router, "storage", svc):
            with patch("subprocess.Popen", side_effect=lambda cmd: opened.append(cmd) or object()):
                r = c.post("/api/images/reveal")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["success"])
        self.assertEqual(r.json()["path"], "assets/generated")
        self.assertEqual(len(opened), 1)
        self.assertIn("generated", opened[0][-1])


if __name__ == "__main__":
    unittest.main()
