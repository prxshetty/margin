"""Env overrides that let the E2E suite run against isolated settings and workspace."""
import unittest
from pathlib import Path

from api.services.file_storage import (
    CONFIG_DIR_ENV,
    DEFAULT_WORKSPACE_ENV,
    resolve_config_dir,
    resolve_default_workspace_dir,
)


class TestIsolatedConfig(unittest.TestCase):
    def test_config_dir_defaults_when_unset_or_blank(self):
        default = Path("default-config")
        self.assertEqual(resolve_config_dir(default, env={}), default)
        self.assertEqual(resolve_config_dir(default, env={CONFIG_DIR_ENV: "   "}), default)

    def test_config_dir_override(self):
        self.assertEqual(
            resolve_config_dir(Path("default-config"), env={CONFIG_DIR_ENV: "/tmp/e2e/config"}),
            Path("/tmp/e2e/config"),
        )

    def test_default_workspace_is_sample_workspace_when_unset(self):
        base = Path("repo")
        self.assertEqual(resolve_default_workspace_dir(base, env={}), base / "sample-workspace")
        self.assertEqual(resolve_default_workspace_dir(base, env={DEFAULT_WORKSPACE_ENV: ""}), base / "sample-workspace")

    def test_default_workspace_override(self):
        self.assertEqual(
            resolve_default_workspace_dir(Path("repo"), env={DEFAULT_WORKSPACE_ENV: "/tmp/e2e/ws"}),
            Path("/tmp/e2e/ws"),
        )


if __name__ == "__main__":
    unittest.main()
