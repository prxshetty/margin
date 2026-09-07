import json
import tempfile
import unittest
from pathlib import Path

from api.routers import assist
from api.services.file_storage import FileStorageService


def _subseq(argv, seq):
    """True when seq appears in argv in order (not necessarily adjacent)."""
    it = iter(argv)
    return all(any(item == want for item in it) for want in seq)


class TestResumeArgv(unittest.TestCase):

    def test_opencode_resume_flag(self):
        argv = assist._resolve_harness_argv(
            "opencode", "do it", "/tmp/w", mode="edit", resume_id="ses_abc")
        self.assertTrue(_subseq(argv, ["run", "--session", "ses_abc"]))
        self.assertEqual(argv[-1], "do it")

    def test_opencode_fresh_has_no_resume(self):
        argv = assist._resolve_harness_argv("opencode", "do it", "/tmp/w")
        self.assertNotIn("--session", argv)

    def test_claude_resume_flag(self):
        argv = assist._resolve_harness_argv(
            "claude-code", "do it", "/tmp/w", mode="chat", resume_id="sid-1")
        self.assertTrue(_subseq(argv, ["--resume", "sid-1"]))
        self.assertEqual(argv[-1], "do it")

    def test_codex_resume_subcommand(self):
        argv = assist._resolve_harness_argv(
            "codex", "do it", "/tmp/w", mode="edit", resume_id="tid-1")
        self.assertTrue(_subseq(argv, ["exec", "resume", "tid-1"]))
        self.assertEqual(argv[-1], "do it")

    def test_agy_resume_flag_before_print(self):
        argv = assist._resolve_harness_argv(
            "agy", "do it", "/tmp/w", mode="edit", resume_id="cid-1")
        self.assertTrue(_subseq(argv, ["--conversation", "cid-1"]))
        # agy's --print swallows the next arg, so the prompt stays last.
        self.assertEqual(argv[-2:], ["--print", "do it"])

    def test_unknown_harness_raises(self):
        with self.assertRaises(ValueError):
            assist._resolve_harness_argv("nope", "do it", "/tmp/w")


class TestSessionCapture(unittest.TestCase):

    def test_opencode_session_id(self):
        line = json.dumps({"type": "text", "sessionID": "ses_X",
                           "part": {"type": "text", "text": "yo"}})
        events = assist._parse_opencode_line(line)
        self.assertIn(("session", "ses_X"), events)
        self.assertIn(("chunk", "yo"), events)

    def test_claude_session_id(self):
        line = json.dumps({"type": "result", "session_id": "cl-1",
                           "usage": {}})
        events = assist._parse_claude_line(line)
        self.assertIn(("session", "cl-1"), events)

    def test_codex_thread_id(self):
        line = json.dumps({"type": "thread.started",
                           "thread_id": "tid-9"})
        events = assist._parse_codex_line(line, {})
        self.assertIn(("session", "tid-9"), events)

    def test_agy_conversation_id(self):
        events = assist._parse_agy_line(
            json.dumps({"event": "init", "conversation_id": "cid-7"}))
        self.assertIn(("session", "cid-7"), events)
        events = assist._parse_agy_line(json.dumps(
            {"event": "result",
             "result": {"conversation_id": "cid-7", "status": "SUCCESS"}}))
        self.assertIn(("session", "cid-7"), events)


class TestRunOutcome(unittest.TestCase):

    def test_write_tool_counts(self):
        self.assertTrue(assist._is_write_tool("write", "a/b.md"))
        self.assertTrue(assist._is_write_tool("replace_file_content", "/x/y.md"))
        self.assertTrue(assist._is_write_tool("edit", "CHAPTERS.md"))

    def test_reads_and_pathless_do_not_count(self):
        self.assertFalse(assist._is_write_tool("read", "a/b.md"))
        self.assertFalse(assist._is_write_tool("glob", "a/*.md"))
        self.assertFalse(assist._is_write_tool("grep", "pattern"))
        self.assertFalse(assist._is_write_tool("bash", None))
        self.assertFalse(assist._is_write_tool("mcp", None))

    def test_mutating_shell_counts_as_write(self):
        self.assertTrue(assist._is_write_tool(
            "bash", None, "rm chapters/chapter-3.md"))
        self.assertTrue(assist._is_write_tool(
            "bash", None, "git status; rm -f tmp.md"))
        self.assertTrue(assist._is_write_tool(
            "bash", None, "mv a.md b.md"))
        self.assertFalse(assist._is_write_tool(
            "bash", None, "git status; ls -la"))
        self.assertFalse(assist._is_write_tool(
            "bash", None, "echo hello"))

    def test_error_without_writes_fails(self):
        self.assertFalse(assist._harness_run_ok(True, False))

    def test_error_with_writes_succeeds(self):
        self.assertTrue(assist._harness_run_ok(True, True))

    def test_clean_run_succeeds(self):
        self.assertTrue(assist._harness_run_ok(False, False))
        self.assertTrue(assist._harness_run_ok(False, True))


class TestHarnessSessionMap(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.storage = FileStorageService(base_dir=self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_round_trip(self):
        self.assertIsNone(self.storage.get_harness_session("m1", "opencode"))
        self.storage.set_harness_session("m1", "opencode", "ses_1")
        self.assertEqual(
            self.storage.get_harness_session("m1", "opencode"), "ses_1")
        # Other harnesses/sessions are independent.
        self.assertIsNone(self.storage.get_harness_session("m1", "agy"))
        self.assertIsNone(self.storage.get_harness_session("m2", "opencode"))

    def test_clear_single_harness(self):
        self.storage.set_harness_session("m1", "opencode", "ses_1")
        self.storage.set_harness_session("m1", "agy", "cid_1")
        self.storage.clear_harness_session("m1", "opencode")
        self.assertIsNone(self.storage.get_harness_session("m1", "opencode"))
        self.assertEqual(
            self.storage.get_harness_session("m1", "agy"), "cid_1")

    def test_map_file_lives_in_workspace_outputs(self):
        self.storage.set_harness_session("m1", "opencode", "ses_1")
        path = Path(self.tmp.name) / "sample-workspace" / "outputs" \
            / "harness_sessions.json"
        self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
