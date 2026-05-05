---
name: deepseek-junior
description: Delegate code work to DeepSeek V4 (the deepseek_* MCP tools) when a task can be broken into mechanical chunks. Trigger when the user has a multi-step plan, when scanning unknown folders, when generating boilerplate, or when getting a second opinion on risky code. CRITICAL — before every delegation, you (the orchestrator) MUST identify which skills, conventions, or domain rules apply and inline them into the DeepSeek prompt. DeepSeek does NOT auto-load skills; it only knows what you tell it.
---

# DeepSeek Junior — when and how to delegate

You have four DeepSeek tools (`deepseek_explore`, `deepseek_implement`,
`deepseek_review`, `deepseek_ask`) that act as a junior developer you orchestrate.
You are the head; DeepSeek is the hands.

---

## 🧠 The orchestrator's first job: pick the right skills FOR DeepSeek

DeepSeek is **worse at choosing skills than you are**. It does not see the
host agent's skill list, does not auto-load skills, and won't know that a task
is "really a tdd task" or "really a security-review task" unless you tell it.
Your job before every call is to do the routing it can't.

### Pre-flight checklist (run this in your head BEFORE every `deepseek_*` call)

1. **What kind of task is this really?**
   Implementation? Debugging? Migration? Refactor? Security-sensitive change?
   Test writing? Performance work? UI work? Each of these maps to different
   skills/conventions in your own toolbelt.
2. **Which of MY skills would I invoke if I were doing this myself?**
   List them explicitly. Examples: `test-driven-development`,
   `systematic-debugging`, `verification-before-completion`,
   `receiving-code-review`, project-local CLAUDE.md rules, framework-specific
   conventions, language style guides.
3. **Which project-specific rules apply?**
   `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, lint configs, naming conventions,
   import rules, banned patterns. DeepSeek won't read these unless you pass
   them or summarize them.
4. **Inline the relevant rules into the prompt.**
   Don't just say "follow best practices" — quote the specific rules. A 10-line
   "rules of engagement" block at the top of the prompt is the single highest-
   leverage thing you can do for output quality.
5. **Pass the right files.** Include the file being changed, 1–2 nearby
   examples that demonstrate the convention, and any types/interfaces it
   depends on. Don't dump the whole repo.

### Prompt template for delegation

When calling `deepseek_implement` or `deepseek_review`, structure the prompt:

```
## Task
<one-paragraph goal — what to build / change / verify>

## Rules of engagement (apply ALL of these)
- <skill or convention 1, stated as a concrete rule>
- <skill or convention 2>
- <project-specific rule from CLAUDE.md / lint / style guide>
- <banned patterns / things to avoid>

## Context you need
- File X does Y (because DeepSeek can't see the chat history)
- The function will be called from Z under condition W

## Acceptance criteria
- <observable outcome 1>
- <observable outcome 2>

## Files attached
<list — and tell DeepSeek which is the target vs reference>
```

This costs you ~30 seconds of writing. It saves a back-and-forth iteration
that costs tokens and wall-clock time.

### Common skill mappings (use these to seed the "rules of engagement" block)

| If the task is…                                   | Inline these rules                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Adding a feature with tests                       | Red-green-refactor TDD: write the failing test first, then minimal code; no untested branches.                                      |
| Fixing a bug                                      | Reproduce first, identify root cause, write a regression test, _then_ fix. No fix without a failing test attached.                  |
| Touching auth, payments, crypto, or PII           | Threat-model the change. Inline OWASP-relevant rules. Demand explicit handling of: input validation, authz checks, error messages.  |
| Refactor with no behaviour change                 | Output must be behaviourally identical. List the exact invariants to preserve. Forbid scope creep ("don't also rename X").          |
| Migration / cross-cutting rename                  | Provide an exhaustive list of files and the exact before/after pattern. Forbid deciding new names creatively.                       |
| Performance work                                  | Demand a measurement plan, not just an optimization. Specify the hot path and the constraint (latency, memory, alloc count).        |
| Code review (`deepseek_review`)                   | Give it a concrete checklist (correctness, security, perf, readability, testability). A vague "review this" returns vague feedback. |
| Generating boilerplate / variations               | Give 1 worked example as a template. DeepSeek will pattern-match better than from prose.                                            |
| UI / frontend                                     | Inline the design system rules, accessibility constraints (ARIA, keyboard, contrast), and forbidden inline styles / magic colors.   |
| Anything where the host has CLAUDE.md / AGENTS.md | Quote the relevant section verbatim. Do not paraphrase.                                                                             |

---

## When to delegate

- **Multi-step plans:** the user wants several files modified and you have a
  plan. For each "mechanical" step (one file, one well-defined change) call
  `deepseek_implement` with the relevant files and rules-of-engagement attached.
- **Codebase scanning:** the user references a folder you haven't read.
  Call `deepseek_explore` first to find the right files — read only those.
- **Pre-commit safety:** before suggesting an irreversible change in
  security-sensitive, financial, or user-facing code, run `deepseek_review`
  with an explicit checklist.
- **Generating variations:** when you need 2–3 candidate approaches without
  spending your own context — `deepseek_ask` with `reasoning=true`.

## When NOT to delegate

- The task is small enough you'd write it yourself in 1–2 turns.
- The task hinges on conversation history that's expensive to re-pack.
- The user explicitly wants you to do it.
- You can't articulate the rules-of-engagement clearly. If you can't write
  them down, DeepSeek will guess — and guess wrong.

---

## How to use the tools well

1. **Be precise.** DeepSeek doesn't see your conversation. Spell out goal,
   constraints, edge cases, how the result will be consumed.
2. **Always include a "rules of engagement" block.** This is the single biggest
   quality lever. See template above.
3. **Pass only relevant files** via the `files` parameter. The server reads
   them from disk; 50 files / 8 MB hard limit per call. Mark which file is
   the _target_ of the change and which are _reference_ / context.
4. **Apply changes yourself.** DeepSeek returns code; you write it to disk
   with your native edit tools. Don't ask DeepSeek to "save" anything.
5. **Iterate freely.** Flash is fast and cheap; if the first answer is off,
   tighten the rules block and call again. Don't bargain with vague output —
   re-prompt.
6. **Verify the output.** Before applying, skim the returned code against the
   rules-of-engagement you sent. If a rule was ignored, that's a re-prompt
   signal, not a "good enough" signal.

## Cost shape (rough)

- `deepseek_explore` (Flash): cheapest, fastest. Default for navigation.
- `deepseek_implement` / `deepseek_review` (Pro + thinking): heavier but
  solves real coding tasks. Use when output quality matters.

---

## Anti-patterns to avoid

- ❌ "Implement rate limiting on /api/login" — no rules, no files, no acceptance criteria. DeepSeek will pick a library you don't use.
- ❌ "Review this code" — too vague. Always attach a checklist.
- ❌ "Follow best practices." — meaningless. Quote the _specific_ rules.
- ❌ Delegating without checking CLAUDE.md / AGENTS.md first.
- ❌ Trusting DeepSeek to know which of your skills applies. **It doesn't. That's your job.**
