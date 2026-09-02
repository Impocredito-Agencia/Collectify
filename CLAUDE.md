# CLAUDE.md

This file is read automatically by Claude Code at the start of every session in this repository. It defines how to work in this codebase. Follow it exactly — it is not optional guidance, it's the operating contract for this project.

## Project overview

Collectify is a monorepo with two independently deployed applications — see `docs/ARCHITECTURE.md` for the full breakdown:

```
collectify/
├── apps/
│   ├── api/       # NestJS REST API — business logic, database, WhatsApp integration
│   └── client/    # React + Vite SPA — admin panel
└── docs/          # Shared project documentation
```

## App-specific instructions

Each app under `apps/` may have its own `CLAUDE.local.md` with conventions, constraints, and required reading specific to that app (e.g. `apps/api/CLAUDE.local.md` for the backend). **Before working inside an app's folder, check for and read that file in full** — it applies on top of this one, not instead of it.

**Both apps are Claude's to maintain — there is no separate frontend developer.** (Updated 2026-09-02: this reverses the earlier "apps/client belongs to a different developer" convention still referenced in some older phase docs — those references are historical, not current policy.) A fix or feature that touches both the API and the admin panel should be implemented on both sides in the same pass, not backend-only with a "frontend follow-up needed" note left for someone else. If a backend change breaks or orphans something in `apps/client` (a button calling a removed endpoint, a param rename, a type change), fix the frontend side too, in the same PR when practical.

## Required reading before writing any code

Before starting _any_ task, read these documents in `docs/`, in this order:

1. `docs/ARCHITECTURE.md` — folder structure, module organization, response format, versioning.
2. `docs/CODING_STANDARDS.md` — naming conventions, TypeScript rules, import order (applies to both apps).
3. `docs/DEFINITION_OF_DONE.md` — the checklist a task must satisfy before it's considered complete.
4. `docs/CONTRIBUTING.md` — branch naming, commit format, PR process.
5. `docs/PROJECT_ROADMAP.md` — phase order. **Never build functionality from a later phase before the current one is done.**

For anything touching business logic or the data model (loans, cuotas, mora, refinanciación, etc.), also read `docs/GLOSSARY.md` and `docs/DATABASE.md` regardless of which app you're working in — the vocabulary and the confirmed data model are shared.

If a specific phase brief exists for the task at hand (`docs/phases/` for `api`, `docs/phasesClient/` for `client`), read that too — it has the concrete scope for that phase.

## Skills

This project has additional skills defined under `.agents/skills/`. **Before starting any task, check if a relevant skill exists in that folder and read it fully before writing code.** Skills encode specific conventions, patterns, or constraints for this project that aren't always obvious from the task description alone — treat them as required reading, the same as the docs listed above, not optional reference material.

If more than one skill could plausibly apply to the current task, read all of them — don't stop at the first match.

## Git workflow — non-negotiable rules

### Branching

- Always work on a feature branch, never directly on `main`.
- Branch naming follows `docs/CONTRIBUTING.md`: `feature/<short-description>`, `fix/<short-description>`, etc. Since this project doesn't use Jira ticket IDs for solo AI-driven development, omit the ticket ID from the branch name and commit message — use a clear descriptive slug instead.
- One branch per phase (or per logical sub-piece of a phase if it's large) — not one giant branch for everything.

### Commits

- **Commit small and often.** Each commit should be one logical change — one entity, one endpoint, one component, one service method plus its test — not a giant "implement auth" commit with 40 files.
- Follow Conventional Commits format from `docs/CONTRIBUTING.md`: `<type>(<scope>): <description>`.
- Examples: `feat(auth): add User entity and migration`, `feat(auth): implement JWT login endpoint`, `test(auth): add unit tests for AuthService`.

### Commit and PR attribution — critical

**Never add any AI attribution to commits or pull requests.** Specifically:

- No `Co-Authored-By: Claude` trailer.
- No "🤖 Generated with Claude Code" footer.
- No mention of Claude, Anthropic, or AI generation anywhere in a commit message or PR description.

Commits should read exactly like a normal developer's commit history. This repository's `.claude/settings.json` already sets `attribution.commit` and `attribution.pr` to empty strings, which should suppress this by default — but if you ever find yourself about to add such a line manually, don't. Treat this as a hard rule, not a preference.

### Pull Requests

- Open a PR when a phase (or meaningful sub-piece of a phase) is complete.
- PR description: what was built, which phase/brief it corresponds to, how to test it manually.
- Since development here is solo (no second developer to review), the human maintainer is the sole reviewer — don't merge without their explicit go-ahead, even though `docs/CONTRIBUTING.md` describes a two-developer review process.

## Working process for each task

1. Read the relevant phase brief in `docs/phases/` or `docs/phasesClient/`.
2. Create the feature branch.
3. Implement in small steps, committing after each coherent piece.
4. Write tests as you go, per the relevant testing conventions — not as an afterthought at the end.
5. Run lint and tests for the app you touched before considering anything done.
6. Update any docs affected by what you built:
   - New env var → update `.env.example` and `docs/ENVIRONMENT_VARIABLES.md`
   - New migration → follow the naming and workflow in `docs/DATABASE.md`
   - Resolved one of the "open questions" in `docs/DATABASE.md` or `docs/GLOSSARY.md` → update those documents to remove the flag once confirmed
7. Self-check against `docs/DEFINITION_OF_DONE.md` before opening the PR.

## When something is ambiguous

If a phase brief or the docs don't specify something you need to make a decision on:

- Check `docs/GLOSSARY.md` and `docs/DATABASE.md` first — many business rules and open questions are already flagged there.
- If it's a genuine open question (e.g. the interest rate assignment rule, or refinancing edge cases), **stop and ask the human** rather than guessing. These are real financial calculations affecting real people's debts — getting it wrong is costly.
- For purely technical decisions not covered by the docs (e.g. a specific NestJS or React pattern), use your judgment consistently with `docs/CODING_STANDARDS.md` and `docs/ARCHITECTURE.md`, and mention the decision in the PR description so the human can flag it if they disagree.

## What not to do

- Don't skip tests to move faster — untested logic that should be tested per the relevant testing doc is not done, per `docs/DEFINITION_OF_DONE.md`.
- Don't build ahead of the current phase in `docs/PROJECT_ROADMAP.md`.
- Don't leave a fix half-done because it crosses from `apps/api` into `apps/client` (or vice versa) — see "Both apps are Claude's to maintain" above.
- Don't add AI attribution anywhere (see above — this is the most important rule in this file).
- Don't guess at ambiguous business rules (interest rate assignment, refinancing behavior, etc.) that are explicitly marked as pending client confirmation in `docs/DATABASE.md`.
