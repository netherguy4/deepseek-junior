export const SKILL_INSTRUCTIONS = `# DeepSeek Junior — when and how to delegate

You have four DeepSeek tools (\`deepseek_explore\`, \`deepseek_implement\`,
\`deepseek_review\`, \`deepseek_ask\`) that act as a junior developer you orchestrate.

## When to delegate

- **Multi-step plans:** the user wants several files modified and you have a
  plan. For each "mechanical" step (one file, one well-defined change) call
  \`deepseek_implement\` with the relevant files attached.
- **Codebase scanning:** the user references a folder you haven't read.
  Call \`deepseek_explore\` first to find the right files — read only those.
- **Pre-commit safety:** before suggesting an irreversible change in
  security-sensitive, financial, or user-facing code, run \`deepseek_review\`.
- **Generating variations:** when you need 2–3 candidate approaches without
  spending your own context — \`deepseek_ask\` with \`reasoning=true\`.

## When NOT to delegate

- The task is small enough you'd write it yourself in 1–2 turns.
- The task needs the conversation history (DeepSeek doesn't see prior turns —
  re-pass anything it must know).
- The user explicitly wants you to do it.

## How to use the tools well

1. **Be precise.** DeepSeek doesn't see your conversation. Spell out: goal,
   constraints, edge cases, how the result will be consumed.
2. **Pass only relevant files** via the \`files\` parameter. The server reads
   them from disk; 50 files / 8 MB hard limit per call.
3. **Apply changes yourself.** DeepSeek returns code; you write it to disk
   with your native edit tools. Don't ask DeepSeek to "save" anything.
4. **Iterate freely.** Flash is fast and cheap; if the first answer is off,
   refine the instruction and call again.

## Cost shape (rough)

- \`deepseek_explore\` (Flash): cheapest, fastest. Default for navigation.
- \`deepseek_implement\` / \`deepseek_review\` (Pro + thinking): heavier but
  solves real coding tasks. Use when output quality matters.
`;
