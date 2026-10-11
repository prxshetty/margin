import unittest
from api.services.file_storage import (
    validate_manifest_content,
    is_manifest_path,
)


class TestManifestValidation(unittest.TestCase):
    def test_is_manifest_path(self):
        self.assertTrue(is_manifest_path("chapters/CHAPTERS.md"))
        self.assertTrue(is_manifest_path("characters/CHARACTERS.md"))
        self.assertTrue(is_manifest_path("styles/STYLES.md"))
        self.assertTrue(is_manifest_path("custom_folder/CUSTOM_FOLDER.md"))
        self.assertTrue(is_manifest_path("characters/characters.md"))

        self.assertFalse(is_manifest_path("chapters/chapter-1.md"))
        self.assertFalse(is_manifest_path("characters/protagonist.md"))
        self.assertFalse(is_manifest_path("CHAPTERS.md"))
        self.assertFalse(is_manifest_path("nested/sub/FOLDER.md"))
        self.assertFalse(is_manifest_path(""))

    def test_validate_empty_manifest(self):
        res = validate_manifest_content("")
        self.assertTrue(res["is_valid"])
        self.assertEqual(res["invalid_lines"], [])
        self.assertEqual(res["total_count"], 0)
        self.assertFalse(res["has_more"])

        res_spaces = validate_manifest_content("   \n\n\t\n")
        self.assertTrue(res_spaces["is_valid"])
        self.assertEqual(res_spaces["invalid_lines"], [])
        self.assertEqual(res_spaces["total_count"], 0)

    def test_validate_valid_manifests(self):
        content = (
            "- chapter-1.md — Opening scene and setup.\n"
            "- **chapter-2.md** – Rising action in the market.\n"
            "- chapter-3.md: The confrontation.\n"
            "- style_general - General writing style guide.\n"
            "- elara_vance.md — Protagonist description.\n"
        )
        res = validate_manifest_content(content)
        self.assertTrue(res["is_valid"])
        self.assertEqual(res["invalid_lines"], [])
        self.assertEqual(res["total_count"], 0)
        self.assertFalse(res["has_more"])

    def test_validate_invalid_manifest_lines(self):
        content = (
            "- chapter-1.md — Opening scene.\n"
            "# Invalid Header Line\n"
            "- chapter-2.md — Second chapter.\n"
            "Stray unstructured text paragraph.\n"
            "- invalid bullet without separator\n"
            "\n"
            "- chapter-3.md — Third chapter.\n"
        )
        res = validate_manifest_content(content)
        self.assertFalse(res["is_valid"])
        # Line 2: Header, Line 4: Stray text, Line 5: Bad bullet
        self.assertEqual(res["invalid_lines"], [2, 4, 5])
        self.assertEqual(res["total_count"], 3)
        self.assertFalse(res["has_more"])

    def test_validate_manifest_capping(self):
        # Create 15 invalid lines
        lines = [f"Invalid line number {i}" for i in range(1, 16)]
        content = "\n".join(lines)

        res = validate_manifest_content(content, max_reported=5)
        self.assertFalse(res["is_valid"])
        self.assertEqual(res["invalid_lines"], [1, 2, 3, 4, 5])
        self.assertEqual(res["total_count"], 15)
        self.assertTrue(res["has_more"])


if __name__ == "__main__":
    unittest.main()
