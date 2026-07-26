/**
 * Names the compiler mints for binders the source never wrote. The lexer
 * reserves the `__hex_` prefix, so no user identifier can collide with one —
 * but for the same reason no user may be *shown* one: a diagnostic naming a
 * synthetic binder would advise writing an identifier the lexer refuses
 * (Declarations Preamble §1.1, the Rewrite Rule).
 *
 * A pattern parameter's binder is minted here and rendered back as `_`
 * wherever a name reaches the reader.
 */

const parameterPrefix = "__hex_parameter";

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
