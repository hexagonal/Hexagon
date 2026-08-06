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
 * naming the pre-registered constraint, not a second `Eq`". Ten of them are
 * banned. The ban follows the declaration, and never precedes it: banning a
 * redeclaration the compiler holds no declaration for would not refuse a twin,
 * it would delete the only spelling the feature has.
 *
 * `Integral` was held back for exactly that reason and is held back no longer.
 * Since #335 the compiler holds its declaration — `stdlib/Integral.hex` is a
 * prelude member, so `div`/`mod`/`quot`/`rem`/`gcd` are in bare scope and
 * `Integral.div` is qualified access to an export — and a module-level
 * `constraint Integral<a> = ...` is now the ordinary twin the ban exists for.
 *
 * `Iterable` is the one remaining name-only remnant. The compiler holds no
 * declaration for it: its members are reachable in v1 solely through a source
 * `constraint Iterable<c> = ...`, which is what `for value in bag` over a user
 * `honor Iterable<Bag>` needs. It is owed to the collections arc (#283), and
 * its ban lands with its declaration.
 */
export const NON_REDECLARABLE_CONSTRAINTS: readonly string[] =
  PRE_REGISTERED_CONSTRAINTS.filter((name) => name !== "Iterable");

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
 * `Iterable` is absent for the reason it is absent from the redeclaration ban:
 * the compiler holds no declaration for it, so a user's source declaration is
 * the only statement of its members, and the lookup above finds that.
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
  Integral: ["div", "mod", "quot", "rem", "gcd"],
};

export function isPreRegisteredConstraint(name: string): boolean {
  return PRE_REGISTERED_CONSTRAINTS.includes(name);
}

/** The identity of a pre-registered constraint: compiler-global, import-free. */
export function preRegisteredConstraintIdentity(name: string): string {
  return `hex:${name}`;
}

/** The identity of a constraint declared by the module with this file id. */
export function declaredConstraintIdentity(
  fileId: number,
  name: string,
): string {
  return `${fileId}:${name}`;
}
