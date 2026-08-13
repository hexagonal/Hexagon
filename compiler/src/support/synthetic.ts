/**
 * Names the compiler mints for binders the source never wrote. Lexer §3.2
 * reserves the `__` prefix, so no user identifier can collide with one — but for
 * the same reason no user may be *shown* one: a diagnostic naming a synthetic
 * binder would advise writing an identifier a Hexagon name seat refuses
 * (Declarations Preamble §1.1, the Rewrite Rule).
 *
 * A pattern parameter's binder is minted here and rendered back as `_`
 * wherever a name reaches the reader.
 */

/**
 * The prefix reserved for compiler-minted names (Lexer §3.2). Widened from the
 * exact `__hex_` at #425: a double leading underscore means the compiler wrote
 * the name, whatever follows it.
 */
const reservedPrefix = "__";

const parameterPrefix = `${reservedPrefix}parameter`;

/**
 * Whether a name was minted by the compiler rather than written.
 *
 * The broad test, for the places that show the user a *list* of names rather
 * than one name: an editor's completions must not offer a binder that would be
 * refused where the user would type it, whatever minted it.
 */
export function isCompilerMinted(name: string): boolean {
  return name.startsWith(reservedPrefix);
}

/** The binder a pattern parameter destructures from. Not writable in source. */
export function syntheticParameterName(index: number): string {
  return `${parameterPrefix}${index}`;
}

export function isSyntheticParameterName(name: string): boolean {
  return name.startsWith(parameterPrefix);
}

/** Renders a binder for the reader, hiding synthetic ones behind `_`. */
export function displayParameterName(name: string): string {
  return isSyntheticParameterName(name) ? "_" : name;
}
