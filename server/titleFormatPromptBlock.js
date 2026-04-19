/**
 * Shared LLM instructions for YouTube title patterns (Video Info + recommend titles).
 */
export const TITLE_FORMAT_LLM_BLOCK = String.raw`
TITLE FORMATS — Use these archetypes (fill blanks from the content summary; do not copy placeholder text literally).
Each title must be at most 10 words (count carefully; shorter is fine).

- Curiosity Gap — "I Tried ___ for 7 Days… Here's What Happened"
- Numbered List — "10 Ways to ___ (That Actually Work)"
- Transformation — "From ___ to ___ in ___ Days"
- How-To — "How to ___ in ___ Minutes (Beginner Guide)"
- Mistakes — "Stop Doing This If You Want to ___"
- Question Hook — "Why Does ___ Always ___?"
- Challenge — "I Played ___ With ONLY ___"
- Secrets — "Nobody Tells You This About ___"
- Comparison — "___ vs ___: Which Is Better?"
- Shock/Result — "This Changed Everything About ___"
`.trim()
