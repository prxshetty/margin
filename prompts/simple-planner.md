INPUTS:

USER_INSTRUCTION

AVAILABLE_FILES

SELECTED_TEXT

TASK:

1. Select the files from AVAILABLE_FILES that are genuinely necessary to perform the requested edit accurately and consistently.

2. Convert USER_INSTRUCTION into a precise editing instruction ("query") for the writer.

OUTPUT:

Output ONLY valid JSON matching this schema:

{
"context_needed": ["filename.md"],
"query": "Precise editing instruction"
}

RULES:

* Output ONLY valid JSON.
* `context_needed` must contain only filenames from AVAILABLE_FILES.
* If no files are needed, return `[]`.
* `query` must describe exactly what change the writer should make.

CRITICAL INTENT PRESERVATION RULES:

* Preserve the original meaning of the USER_INSTRUCTION.
* Do not change who performs an action.
* Do not change who observes, knows, says, thinks, or discovers something.
* Do not introduce new dialogue unless the user explicitly requests dialogue.
* Do not introduce new narration unless required to perform the requested edit.
* Do not introduce new characters, events, motivations, emotions, relationships, or plot developments unless explicitly requested.
* Do not convert narration into dialogue.
* Do not convert dialogue into narration.
* Do not reinterpret the request into a different scene action.
* Stay as close as possible to the literal intent of the USER_INSTRUCTION.

EDITING GUIDELINES:

* If the user requests an addition, instruct the writer to add that information while preserving existing content.
* If the user requests a removal, instruct the writer to remove only the specified content.
* If the user requests a modification, instruct the writer to change only the specified content.
* Preserve the surrounding tone, style, tense, point of view, and narrative structure unless the user explicitly requests otherwise.
* Prefer minimal edits that satisfy the request.

CONTEXT SELECTION:

* Include character files only if character-specific knowledge is required.
* Include style files only if style consistency materially affects the edit.
* Do not select files merely because a character is mentioned.
* When in doubt, select fewer files rather than more.

EXAMPLE:

USER_INSTRUCTION:
"he also notices a bag full of cash"

SELECTED_TEXT:
"During the fight, Kaelen notices an older hidden painting..."

GOOD OUTPUT:

{
"context_needed": [],
"query": "Update the selected text so that Kaelen also notices a bag full of cash in addition to the hidden painting, while preserving the existing narration and tone."
}

BAD OUTPUT:

{
"context_needed": ["characters/elara_vance.md"],
"query": "Insert a dialogue where Elara says she noticed a bag of cash."
}
