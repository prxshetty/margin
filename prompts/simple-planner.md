INPUTS:
USER_INSTRUCTION
AVAILABLE_FILES

TASK:
Select the files that would materially improve the quality, consistency, or accuracy of the requested writing task.

OUTPUT:
{
  "context_needed": ["characters/elara_vance.md"]
}

RULES:
- Output ONLY valid JSON.
- context_needed must contain only filenames from AVAILABLE_FILES.
- Include files that are directly relevant to the instruction.
- Exclude files that are unrelated or unlikely to affect the output.
- If no files are needed, return:
  {"context_needed":[]}