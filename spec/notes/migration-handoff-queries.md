# Migration Handoff — Queries & Concerns

**From:** Claude (chat-side), 2026-07-11
**Context:** Hexagon spec corpus moving to VS Code + GitHub. Chats are not migrating; everything a future session needs must live in the spec files themselves.

---

## 1. Duplicate Part 2 file — resolve before first commit ⚠️

The project contains **two versions** of the Hash / type-members spec:

- `collections-part2-hash-and-type-members.md` (435 lines)
- `collections-part2-hash-and-type-members__1_.md` (473 lines)

They are **not** duplicates. The `__1_` file is the **later, corrected revision**. I diffed them; the `__1_` version differs in two substantive, deliberate corrections (both carrying §16 correction-record markers):

1. **§2.4 rewritten** — public `hash` remains deterministic and unseeded, but stdlib table placement is **seeded** (`mix(processSeed, hash(k))`); iteration order is stable only within one program execution, explicitly unstable across runs (reverting the cross-run extension the older file made). HashDoS rationale, Rust/Go/Python precedent, `HEXAGON_HASH_SEED` implementation note.
2. **§6 rewritten** — associated type identity is **(owner constraint, member name)**; no module-level namespace registration; two constraints in one module may both declare `type Item`; owner-relative scoping with occlusion inside bodies.

Part 4 (`Map`/`Set`) was written against the corrected version — its iteration-order and DoS story depends on the seeded-placement decision.

**Action:** delete the 435-line file, rename `__1_` to the canonical filename. Do this in the first commit so git history never contains a fork.

## 2. Pending cross-spec edit notes — good moment to flush them

House convention: edit notes live in the originating doc and are applied on next touch of the target. Targets with known pending notes: `pattern-matching.md`, `products.md`, `modules.md`, `hexagon-for-typescript-coders.md`, and possibly others from the Sol-review closure and Collections Parts 1–4. Two options:

- **(a)** Leave the convention as-is; first VS Code session on each doc applies its notes (status quo, fine).
- **(b)** Do a one-time sweep commit ("apply all pending edit notes") so the repo starts clean and the convention restarts from zero.

I'd mildly favour (b) — a repo is a better place than chat memory for guaranteeing notes don't rot, but only if they're applied while their originating docs are fresh. Your call; no action needed if (a).

## 3. Files whose status I want confirmed

- `__Hexagon_Language_early_draft.md` — superseded by the spec corpus. Keep as historical reference (maybe under `/archive/`), or drop from the repo?
- `chatgpt-vector-map-set.md` — Sol input material. Same question: archive folder, or first-class?
- `method-syntax.md` — this exists in the project but I don't have its status in my working picture (landed spec vs. draft vs. agenda). Worth a Status header check so the repo's roadmap doc reflects it.
- `decisions-batch-2026-07.md` / `decisions-sol-review-2026-07.md` — dated closure docs. Suggest a `/decisions/` folder convention now, since more will accumulate.

## 4. Repo hygiene suggestions (take or leave)

- **README.md** pointing at `spec-roadmap.md` and stating reading order + the house spec style, so any tool (or model) landing cold in the repo knows the conventions (Status blocks, numbered-section stability, "do not relitigate" markers, edit-note protocol).
- **Section-number stability now has teeth**: cross-references like "Constraints §2.2" are load-bearing across ~30 files. A one-line CONTRIBUTING note ("never renumber; append or use correction records") is cheap insurance.
- Since chats aren't migrating: any decision rationale that currently exists *only* in conversation is gone after this move. I believe the specs are self-contained on this front — decisions logs and rejected-alternatives sections were written precisely for this — but if you know of any decision you've been carrying in your head or in a chat rather than a doc, now is the moment to land it.

## 5. Where the roadmap stands (for the repo's benefit, no query)

Remaining major items, per the roadmap and Collections plan: **Part 5** (normative `Iterable`, worked `Bag`, transients decision), **FFI/extern** (agenda doc exists, seven items queued, `List(a)`/`Array(a)` package pre-decided), **stdlib listing boundary**, **full lexer spec**, **program structure spec**, plus the abstraction/modules pedagogical session. v2 candidates tracked in the usual places.

---

Nothing here blocks the move. Item 1 is the only thing I'd insist on before the first commit.
