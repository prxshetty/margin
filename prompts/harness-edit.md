INPUTS:

SELECTED_TEXT (the passage the user has selected to change, if provided)
ANCHOR_PARAGRAPH_TEXT (the paragraph the user's cursor is on, if there is no selection)

WORKSPACE INDEXES: manifests listing the workspace's characters, chapters, and styles.

IMAGES: documents may reference images stored in the workspace's assets/ directory (e.g. ![alt](assets/foo.png "caption")). When visual information is relevant to the task, inspect the appropriate image files using your available tools.

INSTRUCTIONS:
Make the edits wherever needed in the workspace.

When SELECTED_TEXT is present, the instruction targets that passage: replace the selected text in the file with your version. The new text takes the selection's place — do not keep the original passage alongside it.