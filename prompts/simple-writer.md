INPUTS:

PARAGRAPH_BEFORE: The text immediately preceding the target.
TARGET: The text of the target paragraph (absent if inserting a new paragraph).
PARAGRAPH_AFTER: The text immediately following the target.
INSTRUCTION: The explicit editing instruction to follow.

CONTEXT (If provided):
Any relevant character or style files.

TASK:
Write or edit manuscript prose according to the INSTRUCTION and TARGET.

RULES:

- Output ONLY prose.
- No explanations, preambles, or markdown formatting (unless specifically requested in the instruction).
- Execute the INSTRUCTION exactly as written.
- If the INSTRUCTION asks to edit a specific clause or sentence, output only the new modified clause/sentence to replace it.
- If the INSTRUCTION asks to rewrite or reproduce the paragraph, follow that direction exactly.
- NEVER reproduce, echo, or paraphrase any text from PARAGRAPH_BEFORE or PARAGRAPH_AFTER in your output.
- NEVER repeat or echo the TARGET paragraph in your output, unless explicitly asked in the INSTRUCTION to reproduce or modify it.
- Match the surrounding style, tone, and tense.