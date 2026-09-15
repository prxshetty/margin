"""Regression test: harness_env must include Windows agy/npm dirs on win32."""
import os
import sys
import unittest
from unittest import mock


class TestHarnessEnvWindowsPath(unittest.TestCase):
    def test_win32_extra_bin_dirs(self):
        fake_local = r"C:\Users\test\AppData\Local"
        fake_roaming = r"C:\Users\test\AppData\Roaming"
        with mock.patch.object(sys, "platform", "win32"), \
             mock.patch.dict(os.environ, {"LOCALAPPDATA": fake_local, "APPDATA": fake_roaming}, clear=False):
            import importlib
            import api.services.harness_env as he
            importlib.reload(he)
            try:
                self.assertIn(os.path.join(fake_local, "agy", "bin"), he._EXTRA_BIN_DIRS)
                self.assertIn(os.path.join(fake_roaming, "npm"), he._EXTRA_BIN_DIRS)
            finally:
                importlib.reload(he)

    def test_posix_has_homebrew_dirs(self):
        import importlib
        import api.services.harness_env as he
        with mock.patch.object(sys, "platform", "darwin"):
            importlib.reload(he)
            try:
                self.assertIn("/opt/homebrew/bin", he._EXTRA_BIN_DIRS)
            finally:
                importlib.reload(he)


if __name__ == "__main__":
    unittest.main()
