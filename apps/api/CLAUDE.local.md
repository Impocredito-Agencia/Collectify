# CLAUDE.local.md — apps/api

This file applies on top of the root `CLAUDE.md` whenever you're working inside `apps/api` (the NestJS backend). Read the root file first, then this one.

## Scope of this folder

`apps/api` is the NestJS backend. **`apps/client` is not a separate developer's territory** (see the root `CLAUDE.md`, updated 2026-09-02) — when a backend change here breaks or orphans something in the admin panel (a removed endpoint a button still calls, a renamed param, a changed response shape), fix `apps/client` in the same pass rather than flagging it as someone else's follow-up.

## Required reading before writing any backend code

In addition to the project-wide reading list in the root `CLAUDE.md`, read these before starting any backend task:

1. `docs/GLOSSARY.md` — business vocabulary (pagaré, cuota, mora, refinanciación). Get this wrong and everything downstream is wrong.
2. `docs/DATABASE.md` — the confirmed data model, including the interest formula and open questions.
3. `docs/TESTING.md` — what must be unit tested and how, in the `api`.

If a specific phase brief exists in `docs/phases/` for the task at hand, read that too — it has the concrete scope for that phase.

## Skills

Check `.agents/skills/` for backend-relevant skills before starting any task — `backend-patterns`, `nestjs-best-practices`, `typeorm`, and `postgresql-optimization` all apply here. Read every one that plausibly applies, not just the first match.

## Working process

1. Read the relevant phase brief in `docs/phases/`.
2. Create the feature branch.
3. Implement in small steps, committing after each coherent piece — entity → migration → service → test → controller → Swagger docs.
4. Write unit tests for all service logic as you go, per `docs/TESTING.md` — not as an afterthought at the end.
5. Run `npm run lint` and `npm run test` (inside `apps/api`) before considering anything done.
6. Self-check against `docs/DEFINITION_OF_DONE.md` before opening the PR.

## What not to do

- Don't skip tests to move faster — untested service logic is not done, per `docs/DEFINITION_OF_DONE.md`.
- Don't build ahead of the current phase in `docs/PROJECT_ROADMAP.md`.
- Don't guess at the interest rate rule or refinancing behavior — these are explicitly marked as pending client confirmation in `docs/DATABASE.md`. Stop and ask the human instead.
