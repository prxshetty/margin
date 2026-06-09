INPUTS:

USER_INSTRUCTION

DOCUMENT_OUTLINE (First 60 characters of each paragraph with index)

SELECTED_TEXT (If provided, this is the guaranteed target context)

ANCHOR_PARAGRAPH_TEXT (If SELECTED_TEXT is not provided, this is the full text of the paragraph containing the user's cursor)

AVAILABLE_CONTEXT (manifest files listing available characters, chapters, and styles with descriptions)

TASK:

1. Select the minimum necessary files from AVAILABLE_CONTEXT to perform the edit accurately.
2. Convert USER_INSTRUCTION into a precise editing instruction ("query") for the writer that carries the user's intent.

OUTPUT SCHEMA:

Output ONLY valid JSON matching this schema:

{
  "context_needed": ["filename.md"],
  "query": "Precise editing instruction"
}

QUERY DECOMPOSITION RULES:

Write a clear, literal, single-task instruction for the writer based on the USER_INSTRUCTION.
- For modifications: "Reproduce the TARGET paragraph in full, verbatim, up to the clause '[verbatim target clause]'. Replace that clause with: [new clause description]."
- For rewriting: "Rewrite this paragraph entirely in [style/POV/tone]."
- For expanding: "Reproduce this paragraph in full, then expand it with [specific additions]."
- For adding new paragraphs: "Write [N] new paragraph(s) that [specific intent], flowing from [anchor context]."

CRITICAL INTENT PRESERVATION RULES:

- Preserve the original meaning of the USER_INSTRUCTION.
- Do not introduce new characters, events, motivations, emotions, relationships, or plot developments unless explicitly requested.
- Do not reinterpret the request into a different scene action.
- Stay as close as possible to the literal intent of the USER_INSTRUCTION.

CONTEXT SELECTION:

Use the descriptions in AVAILABLE_CONTEXT manifests to determine relevance.
- NEVER select chapter files (e.g., chapters/chapter-1.md) for edit-mode tasks. The surrounding paragraph context is already provided directly in the writer prompt. Chapter files are only useful for high-level structural questions, not inline edits.
- Include character files only if character-specific knowledge is required.
- Include style files only if style consistency materially affects the edit.
- Do not select files merely because a character is mentioned.
- When in doubt, select fewer files rather than more.
- Refer to manifests by their section headers: CHARACTERS, CHAPTERS, STYLES.
- context_needed should contain file paths (e.g., "characters/elara_vance.md", "styles/cinematic.md").
