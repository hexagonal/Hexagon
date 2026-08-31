/**
 * Constraint identity (`spec/constraints.md` §5.1.1).
 *
 * A constraint **is its declaration**. Coherence's (constraint, type
 * constructor) key holds declarations, not spellings, so two `constraint`
 * declarations that happen to share a name are distinct constraints whose
 * instances never collide. The identities minted here are what the checker's
 * instance table keys on and what an exported instance carries across a module
 * boundary, in place of the bare name it used to compare.
 *
 * Two spaces, one string form:
 *
 * - `hex:<Name>` — a pre-registered constraint, whose one declaration the
 *   compiler holds (§5.1.1's third bullet). Compiler-global, so every module
 *   agrees on it without any import.
 * - `<fileId>:<Name>` — a constraint declared by module source. Constraints are
 *   module-local in v1, so the declaring file is a complete address; when stage
 *   2 makes them exportable, an importing module will carry the *declaring*
 *   file's identity rather than re-derive one, exactly as an instance already
 *   carries `fileId:dictionary` (`InstanceInterface.identity`).
 *
 * Stability across compilations of one project follows from `fileId`, which is
 * assigned from the project's source order and is the same input the instance
 * identities above already depend on.
 */

/**
 * The constraints the compiler pre-registers (§5.1.1, Modules §6.4).
 *
 * Every name here is known in every module without a declaration, and the
 * wired-in machinery — operator routing, derivation, the collection contracts —
 * reaches its constraint by the single `hex:` identity below.
 */
export const PRE_REGISTERED_CONSTRAINTS: readonly string[] = [
  "Num",
  "Signed",
  "Frac",
  "Pow",
  "Concat",
  "Eq",
  "Ord",
  "Show",
  "Hash",
  "Iterable",
  "Integral",
];

/**
 * The pre-registered names a module may not redeclare.
 *
 * §5.1.1 pins all eleven: "a module-level `constraint Eq<a> = ...` is an error
 * naming the pre-registered constraint, not a second `Eq`". All eleven are
 * banned, and the inventory is the ban — there is no longer a filter here,
 * because there is no longer a name the compiler holds no declaration for.
 *
 * The ban follows the declaration, and never precedes it: banning a
 * redeclaration the compiler holds no declaration for would not refuse a twin,
 * it would delete the only spelling the feature has. `Integral` was held back
 * for exactly that reason until #335 gave it `stdlib/Integral.hex`; `Iterable`
 * was the last one held back, and #353 gave it `stdlib/Iterable.hex` — seated
 * after `Seq.hex`, since `toSeq(xs: c): Seq(Item)` names `Seq`. With that file
 * a prelude member, `toSeq` is in bare scope everywhere, `Iterable.toSeq` is
 * qualified access to an export, and a module-level `constraint Iterable<c> =
 * ...` is the ordinary twin the ban exists for. §5.1.1's name-only state was a
 * compiler gap, not a spec freedom, and it is closed.
 */
export const NON_REDECLARABLE_CONSTRAINTS: readonly string[] =
  PRE_REGISTERED_CONSTRAINTS;

/**
 * The member names of the pre-registered constraints, for the one question that
 * has to be answerable **without** a declaration in view: which spellings does
 * honoring a constraint claim in the honoring module (`#claimHonoredMembers`,
 * consequence 3 of #335)?
 *
 * In a real compile the declarations are here — they are prelude members — and
 * the claim reads the declaration, which is the only thing that can be right
 * for a constraint the user wrote. This table is the fallback for a compile
 * with no prelude at all: the checker and resolver unit harnesses assemble a
 * module by calling the passes directly, and a pre-registered name still means
 * the compiler's constraint there. Without it the same program would be legal
 * in the harness and refused in a real compile, which is the one difference
 * worth spending a table to avoid.
 *
 * Names only, deliberately: the signatures live in the checker's
 * `#checkPreludeHonor`, which is the other wired-in fallback of the same shape,
 * and a second copy of them here would be a second thing to keep true.
 *
 * The table is total over the inventory since #353. `Iterable` was the one
 * absence, and it was absent for the reason it was absent from the ban: no
 * declaration existed to read. `stdlib/Iterable.hex` is that declaration now,
 * so the name claims `toSeq` here exactly as the other ten claim theirs.
 * `Iterable` is deliberately *not* given a `#checkPreludeHonor` signature arm:
 * its provided rows have no source form (Collections Part 5 §4), and the real
 * declaration is visible in every compile that has a prelude at all.
 */
export const PRE_REGISTERED_CONSTRAINT_MEMBERS: Readonly<
  Record<string, readonly string[]>
> = {
  Num: ["add", "multiply", "fromNat"],
  Signed: ["subtract", "negate", "fromInt"],
  Frac: ["divide"],
  Pow: ["pow"],
  Concat: ["concat"],
  Eq: ["equals", "notEquals"],
  Ord: ["compare"],
  Show: ["show"],
  Hash: ["hash"],
  Iterable: ["toSeq"],
  Integral: ["div", "mod", "quot", "rem", "gcd"],
};

/**
 * The constraints an **automatic structural instance** satisfies (Constraints
 * §4.5's structural bullet; Products §2.5, with `Hash` per Collections Part 2
 * §2.5).
 *
 * Structural types — tuples, structural records, and the containers that walk
 * like them — have no constructor name to key an instance on and no home module
 * to write one in (§5.4, §9.3), so these four are the whole of what they honor
 * and the set is closed against user code by construction.
 *
 * Two readers, one inventory. The checker satisfies a requirement at a tuple,
 * record, or `Vector` from it; the specialization planner reads it as `Unit`'s
 * candidate row, `Unit` being the empty tuple and the vacuous arity of the same
 * rule (Zero-Cost Fundamental Exports §3.2's judgment at `Unit` and `Bool`).
 * Names rather than identities because the readers ask in both currencies; all
 * four are pre-registered and non-redeclarable, so the two agree by
 * construction.
 */
export const STRUCTURAL_CONSTRAINTS: readonly string[] = ["Eq", "Ord", "Show", "Hash"];

export function isPreRegisteredConstraint(name: string): boolean {
  return PRE_REGISTERED_CONSTRAINTS.includes(name);
}

/**
 * The uncontested dictionary slot a base constraint asks for
 * (`spec/constraints.md` §6.2).
 *
 * **Transitional** — the ruled spelling is the base declaration's own name
 * *verbatim*, and this lowercases its first letter, which is what the compiler
 * has always written. The case flip is a separate landing; everything else in
 * §6.2 — one currency, the contest, the duplicate refusal — is independent of
 * it, and lands first under the spelling already on disk so that no emitted
 * byte moves for a program with no alias, no qualified base and no collision.
 *
 * Fed the base declaration's **canonical** name, never a referencing spelling.
 */
export function baseConstraintSlot(canonicalName: string): string {
  return (canonicalName[0]?.toLowerCase() ?? "") + canonicalName.slice(1);
}

/**
 * §6.2's slot assignment for one constraint declaration's base list, in the
 * written order of the conjunction and computed from that list alone.
 *
 * Two bases can *want* one spelling — two imported constraints each declared
 * `Tag`, distinct by identity (§5.1.1), which no importer can rename apart.
 * Refusing the meeting would wall off composing two libraries over a word their
 * importer does not own, so the contest resolves positionally instead: an entry
 * takes its canonical slot unless an earlier entry already holds it, and then
 * probes `_1`, `_2`, … skipping any spelling an earlier entry holds *and* any
 * spelling that is another entry's own canonical slot. The second clause is
 * what lets a base declared `Tag_1` keep `tag_1` when a `Tag` collider stands
 * ahead of it: `(Tag, Tag, Tag_1)` mints `tag`, `tag_2`, `tag_1`.
 *
 * The skip list applies only to *probed* spellings. An entry never yields its
 * own canonical slot to a later entry's claim, which is what makes the
 * assignment a function of the written order and nothing else.
 *
 * Deliberately not dictionary-sharing §5's jointly-assigned all-suffixed
 * discipline: that rule answers contests across ranks the resolver assigns
 * together, and a slot contest has one list, one order and no ranks. The
 * written order is ABI-relevant (FFI Part 9 §11), so it is read here and
 * nowhere else — both the module that *writes* the slots (an honor block's base
 * evidence) and the module that *reads* one (an entailment projection) mint
 * through this function, which is what keeps the two from drifting into
 * separate name currencies again (#718).
 */
export function mintBaseConstraintSlots(
  canonicalNames: readonly string[],
): readonly string[] {
  const wanted = canonicalNames.map(baseConstraintSlot);
  const taken = new Set<string>();
  return wanted.map((own, index) => {
    let slot = own;
    let suffix = 0;
    while (
      taken.has(slot) ||
      (slot !== own && wanted.some((other, at) => at !== index && other === slot))
    ) {
      suffix += 1;
      slot = `${own}_${suffix}`;
    }
    taken.add(slot);
    return slot;
  });
}

/** The identity of a pre-registered constraint: compiler-global, import-free. */
export function preRegisteredConstraintIdentity(name: string): string {
  return `hex:${name}`;
}

/**
 * Whether an identity is a **pre-registered** one — the `hex:` space above,
 * asked of an identity rather than of a name.
 *
 * The distinction is the point: a module's own `constraint Show` would mint
 * `<fileId>:Show` (and is refused outright by §5.1.1's ban), so a name is not a
 * safe test for "this constraint's declaration is the prelude's". Modules §7.6's
 * missing-instance report asks exactly this question to decide whether a home is
 * offerable, and it must not be answerable by shadowing.
 */
export function isPreRegisteredIdentity(identity: string): boolean {
  return identity.startsWith("hex:");
}

/** The identity of a constraint declared by the module with this file id. */
export function declaredConstraintIdentity(
  fileId: number,
  name: string,
): string {
  return `${fileId}:${name}`;
}
