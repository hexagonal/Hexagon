/**
 * The match function and its lambda, either way: a refactoring between forms
 * the spec defines as one another.
 *
 * A `match` that ends its logical item is `$x => match $x …` by definition
 * (Pattern Matching §6.7), for a binder no source can name. So
 * `(shape) => match shape …` is the match function wherever `shape` is named in
 * no arm, and the match function is that lambda under any name its arms leave
 * free. Each rewrite is checked by parsing what it leaves (`same-reading.ts`).
 *
 * - **On a match function's `match`**, it is written as a lambda.
 * - **On a lambda's head, or on its `match` and scrutinee**, a lambda whose body
 *   is a `match` on its one parameter is written as a match function. Where
 *   that would lose something the lambda says (its parameter named in an arm,
 *   a written type, a `catch` clause), the rewrite is refused with the reason.
 */

import { lex } from "../passes/lexer/lexer.js";
import * as Source from "../support/source.js";
import type * as Lexed from "../syntax/lexed/index.js";
import type * as Parsed from "../syntax/parsed/index.js";
import { type Refactoring, rewrite, solid, textOf } from "./rewrite.js";
import { matchedBody, namesIn } from "./same-reading.js";
import { enclosingNodes, syntaxTree } from "./syntax-nodes.js";
import { isSyntheticParameterName } from "../support/synthetic.js";

export const TO_MATCH_FUNCTION_TITLE = "Write the lambda as a match function";
export const TO_LAMBDA_TITLE = "Write the match function as a lambda";

/** The parameter a match function written as a lambda is given, or the first of its numbered spellings its arms leave free. */
const PARAMETER = "value";

/** The match function and lambda rewrites offered for `[start, end]` of one parsed module. */
export function matchFunctionRefactorings(
  file: Source.File,
  module: Parsed.Module,
  start: number,
  end: number,
): readonly Refactoring[] {
  const chain = enclosingNodes(syntaxTree(module), start, end);
  // The innermost lambda the range is in: a head holds no other.
  const lambda = chain.findLast(({ expression }) => expression?.kind === "Lambda")?.expression as
    | Parsed.LambdaExpr
    | undefined;
  const match = lambda === undefined ? undefined : matchedBody(lambda);
  if (lambda === undefined || match === undefined) return [];
  if (isMatchFunction(lambda, match)) {
    // Asked from the head: the keyword, which is the whole of it.
    const keyword = lambda.span.start.offset + "match".length;
    return start > keyword ? [] : [asLambda(file, module, lambda, keyword)];
  }
  // A function's header (`let size(shape) = match shape …`) is not a lambda the
  // dev wrote, and has no match function to be.
  if (!written(file, lambda)) return [];
  // Asked from the head (the parameter, the arrow, the keyword or the
  // scrutinee, not an arm), of a `match` on the one parameter. A pattern
  // parameter's binder is one the scrutinee cannot name.
  const [parameter, ...others] = lambda.parameters;
  const onHead = start <= match.scrutinee.span.end.offset;
  const onParameter = parameter !== undefined && others.length === 0 &&
    match.scrutinee.kind === "Name" && match.scrutinee.name.text === parameter.name.text;
  return onHead && onParameter ? [asMatchFunction(file, module, lambda, match, parameter)] : [];
}

/**
 * Whether the parser built this lambda from a scrutinee-less `match`: its one
 * parameter and the scrutinee are the binder §6.7 leaves unnamed, which spans no
 * source. (A pattern parameter's binder is minted the same way, and no source
 * scrutinee can name it.)
 */
function isMatchFunction(lambda: Parsed.LambdaExpr, match: Parsed.MatchExpr): boolean {
  const [parameter] = lambda.parameters;
  return lambda.parameters.length === 1 &&
    isSyntheticParameterName(parameter!.name.text) &&
    match.scrutinee.kind === "Name" &&
    match.scrutinee.name.text === parameter!.name.text;
}

/**
 * Whether the lambda is written as one, with its `=>`, rather than built by the
 * parser from a header (`let size(shape) = …`, an `honor`'s member), whose
 * parameters and body it holds the same way.
 */
function written(file: Source.File, lambda: Parsed.LambdaExpr): boolean {
  const from = lambda.span.start.offset;
  const to = lambda.body.span.start.offset;
  return tokensOf(file).some(({ kind, span }) => kind === "FatArrow" && from <= span.start.offset && span.end.offset <= to);
}

const lexed = new WeakMap<Source.File, readonly Lexed.Token[]>();

function tokensOf(file: Source.File): readonly Lexed.Token[] {
  let tokens = lexed.get(file);
  if (tokens === undefined) lexed.set(file, tokens = lex(file).tokens);
  return tokens;
}

/** `match …` as `(value) => match value …`, under a name the arms leave free. */
function asLambda(file: Source.File, module: Parsed.Module, lambda: Parsed.LambdaExpr, keyword: number): Refactoring {
  const used = namesIn(matchedBody(lambda)!.arms);
  let name = PARAMETER;
  for (let number = 2; used.has(name); number += 1) name = `${PARAMETER}${number}`;
  const { end } = solid(file, lambda.span);
  const arms = file.span(keyword, end);
  return rewrite(file, module, TO_LAMBDA_TITLE, lambda, {
    texts: [`(${name}) => match ${name}${textOf(file, arms)}`],
    kept: [arms],
  });
}

/** `(shape) => match shape …` as `match …`, or why the lambda says more than a match function can. */
function asMatchFunction(
  file: Source.File,
  module: Parsed.Module,
  lambda: Parsed.LambdaExpr,
  match: Parsed.MatchExpr,
  parameter: Parsed.Parameter,
): Refactoring {
  const title = TO_MATCH_FUNCTION_TITLE;
  const name = parameter.name.text;
  if (parameter.annotation !== undefined || lambda.returnAnnotation !== undefined || lambda.typeParameters !== undefined) {
    return { title, disabled: "A match function writes no types, so the lambda's written types would be lost." };
  }
  if (match.catchArms !== undefined) {
    return { title, disabled: "A match function has no `catch` clause." };
  }
  if (namesIn(match.arms).has(name)) {
    return { title, disabled: `\`${name}\` is named in an arm, and a match function's parameter has no name.` };
  }
  const { end } = solid(file, lambda.span);
  const arms = file.span(match.scrutinee.span.end.offset, end);
  return rewrite(file, module, title, lambda, { texts: [`match${textOf(file, arms)}`], kept: [arms] });
}
