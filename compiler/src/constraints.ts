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
 * naming the pre-registered constraint, not a second `Eq`". Two are held back,
 * and the reason is a gap in the compiler rather than a reading of the spec:
 * `Iterable` and `Integral` are pre-registered by *name* only — the compiler
 * holds no declaration for either, so their members are reachable in v1 solely
 * through a source `constraint Iterable<c> = ...` / `constraint Integral<a> =
 * ...`, which is what `stdlib/Integral.hex` is and what `for value in bag` over
 * a user `honor Iterable<Bag>` needs. Banning the redeclaration before the
 * compiler holds those two declarations would not refuse a twin; it would
 * delete the only spelling the feature has. The ban belongs with the
 * declarations, not before them.
 */
export const NON_REDECLARABLE_CONSTRAINTS: readonly string[] =
  PRE_REGISTERED_CONSTRAINTS.filter(
    (name) => name !== "Iterable" && name !== "Integral",
  );

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
