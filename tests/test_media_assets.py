"""Margin image assets: storage validation, traversal guards, endpoint stripping."""
import tempfile
import unittest
from pathlib import Path

from api.routers.assist import strip_images
from api.services.file_storage import FileStorageService

PNG = bytes.fromhex("89504e470d0a1a0a") + b"\x00" * 64
JPG = bytes.fromhex("ffd8ffe000104a464946") + b"\x00" * 64
GIF = b"GIF89a" + b"\x00" * 64
WEBP = b"RIFF" + b"\x00" * 4 + b"WEBP" + b"\x00" * 64


def _storage():
    tmp = tempfile.mkdtemp()
    svc = FileStorageService(base_dir=tmp)
    # Point the workspace at the tmp dir so tests don't touch the repo.
    svc.workspace_dir = Path(tmp)
    return svc


class TestSaveMedia(unittest.TestCase):
    def test_png_jpg_gif_webp_accepted(self):
        svc = _storage()
        for data, name, ext, mime in [
            (PNG, "cover.png", "png", "image/png"),
            (JPG, "photo.JPG", "jpg", "image/jpeg"),
            (GIF, "anim.gif", "gif", "image/gif"),
            (WEBP, "shot.webp", "webp", "image/webp"),
        ]:
            with self.subTest(name=name):
                r = svc.save_media_bytes(data, name, mime)
                self.assertTrue(r["path"].startswith("assets/"))
                self.assertTrue(r["path"].endswith(f".{ext}"))
                full, got = svc.read_media(r["path"])
                self.assertTrue(full.exists())
                self.assertEqual(got, mime)

    def test_non_image_rejected(self):
        svc = _storage()
        with self.assertRaises(ValueError):
            svc.save_media_bytes(b"hello world, not an image", "x.png", "image/png")

    def test_traversal_rejected(self):
        svc = _storage()
        for bad in ["../settings.json", "assets/../x.png", ".hidden.png",
                    "/etc/passwd", "", "assets/"]:
            with self.subTest(path=bad):
                with self.assertRaises((ValueError, FileNotFoundError)):
                    svc.read_media(bad)

    def test_filename_slugified(self):
        svc = _storage()
        r = svc.save_media_bytes(PNG, "My Cool Cover!!!.PNG", "image/png")
        self.assertRegex(r["name"], r"^my-cool-cover-\d+\.png$")

    def test_no_size_cap(self):
        # Local-first: a large honest image is the user's own disk.
        svc = _storage()
        big = bytes.fromhex("89504e47") + b"\x00" * (12 * 1024 * 1024)
        r = svc.save_media_bytes(big, "huge.png", "image/png")
        self.assertTrue(r["path"].endswith(".png"))


class TestStripImages(unittest.TestCase):
    def test_alt_and_caption(self):
        self.assertEqual(
            strip_images('See ![city map](assets/map.png "Kaelen\\\'s sketch") below.'),
            "See [image: city map \u2014 Kaelen\\'s sketch] below.",
        )

    def test_alt_only(self):
        self.assertEqual(
            strip_images("![cover](assets/cover.png)"), "[image: cover]")

    def test_bare(self):
        self.assertEqual(strip_images("![](assets/x.png)"), "[image]")

    def test_remote_and_plain_text_untouched(self):
        self.assertEqual(strip_images("![a](http://x/y.png)"), "[image: a]")
        self.assertEqual(strip_images("no images here"), "no images here")
        self.assertEqual(strip_images(""), "")
        self.assertEqual(strip_images(None), "")


if __name__ == "__main__":
    unittest.main()
