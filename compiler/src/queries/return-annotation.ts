/**
 * Compiler-owned source query: the return type an exported function did not
 * write, and where the text for it goes.
 *
 * Modules §4.1.1 requires an exported function to annotate every parameter and
 * its result, and the checker says so against the declaration's name. The type
 * itself is never in doubt — inference has already worked it out, and the error
 * is about the signature being unwritten rather than unknown — so the repair is
 * a question of *spelling* it in this module's scope and finding the one place
 * the colon may go (Functions §4.1: after the parameter list, never elsewhere).
 *
 * This decides both and stops there. Whether the resulting edit is safe to offer
 * is `AnalysisSession`'s question, because answering it means compiling the
 * edited project — which this query, reading one finished tree, cannot do.
 */

import type * as Diagnostics from "../support/diagnostics.js";
import type * as LaidOut from "../syntax/laid-out/index.js";
import type * as Lexed from "../syntax/lexed/index.js";
import type * as Resolved from "../syntax/resolved/index.js";
import type * as Source from "../support/source.js";
import type * as Typed from "../syntax/typed/index.js";
import { spellType, typeNamesOf, unspellable, VariableNames } from "./type-spelling.js";

/** The declaration a return annotation would be written on. */
export interface ReturnAnnotationSubject {
  /** The declaration's name — where the diagnostic sits, and what identifies it. */
  readonly binding: Source.Span;
  readonly name: string;
  /**
   * Whether the module exports it. Carried because it decides whether anything
   * *requires* the annotation: Modules §4.1.1 asks for a complete signature at
   * the module boundary and nowhere else, so this is the difference between a
   * repair for a reported error and an unasked-for change to a private function.
   */
  readonly exported: boolean;
}

/** A return annotation that can be written, and the edits that write it. */
export interface ReturnAnnotationPlan extends ReturnAnnotationSubject {
  /** The type as source text, without the colon. */
  readonly annotation: string;
  readonly edits: readonly Diagnostics.Edit[];
}

/** A return annotation this module cannot write, and the reason. */
export interface ReturnAnnotationRefusal extends ReturnAnnotationSubject {
  readonly refused: string;
}

export type ReturnAnnotationResult = ReturnAnnotationPlan | ReturnAnnotationRefusal;

export function refusedAnnotation(
  result: ReturnAnnotationResult,
): result is ReturnAnnotationRefusal {
  return "refused" in result;
}

export interface ReturnAnnotationInput {
  readonly resolved: Resolved.Module;
  readonly typed: Typed.Module;
  /**
   * This module's own file, laid out — the parser's own stream, for the one
   * question `unsettledBy` asks of it.
   */
  readonly laidOut: LaidOut.File;
  /**
   * This module's own file, lexed — see `insertionPlan` and `unclosedGroupIn`
   * for what its tokens are read for. A whole file rather than an
   * array of tokens because they are read by *offset*: taking the file says
   * which text those offsets are into, where a bare array would leave every
   * reader of it re-checking, or forgetting to.
   */
  readonly lexed: Lexed.File;
  /** This file's diagnostics — see `unsettledBy` for what they decide. */
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
  /** An offset on the declaration's name. */
  readonly offset: number;
  readonly fileOfSpecifier?: (specifier: string) => Source.FileId | undefined;
}

/**
 * The return annotation for the function declared at this offset.
 *
 * `undefined` means there is no such function here — no declaration name at the
 * offset, or one that already writes its result type — and is a different answer
 * from a refusal, which means there is one and it cannot be written.
 */
export function planReturnAnnotation(
  input: ReturnAnnotationInput,
): ReturnAnnotationResult | undefined {
  const found = functionAt(input.resolved, input.offset);
  if (found === undefined) return undefined;
  const { item, lambda } = found;
  const subject: ReturnAnnotationSubject = {
    binding: item.binding.span,
    name: item.binding.name,
    exported: item.exported,
  };

  // Asked before anything else because it is the most specific thing that can be
  // said. An unclosed parameter list is also a parse error in the head, so
  // `unsettledBy` would refuse it too — in the general terms it uses for a head
  // that will not check, where this names the missing `)` the user is one
  // keystroke from typing. The narrower sentence is the more useful one, and
  // asking for it first is what keeps this refusal reachable at all.
  //
  // The sentence is an inference from the plan's absence rather than a reading
  // of the text, and it is the right inference for what puts a user here:
  // `= (1)) = x` recovers a *closed* list the parser rejected, and is told about
  // the parameter list when the truer complaint is the one the parser already
  // made. Both point at the same line, so this costs precision, not direction.
  const writeEdits = insertionPlan(input.lexed, lambda);
  if (writeEdits === undefined) {
    return {
      ...subject,
      refused: `\`${item.binding.name}\` has no closed parameter list to write a return type after`,
    };
  }

  const broken = unsettledBy(input.diagnostics, input.lexed, input.laidOut, item, lambda);
  if (broken !== undefined) return { ...subject, refused: broken };

  const symbol = input.typed.symbols.find(({ id }) => id === item.binding.symbol);
  if (symbol === undefined || symbol.scheme.type.kind !== "Function") return undefined;
  const type = symbol.scheme.type;

  const variables = new VariableNames();
  // Every spelling the signature already uses is reserved before anything is
  // minted, including the type parameters, whose names are declared but need not
  // appear in any annotation.
  for (const parameter of lambda.typeParameters ?? []) variables.reserve(parameter.name);
  lambda.parameters.forEach((parameter, at) => {
    const inferred = type.parameters[at];
    if (parameter.annotation !== undefined && inferred !== undefined) {
      variables.learn(parameter.annotation, inferred);
    }
  });

  const spelled = spellType(
    type.result,
    typeNamesOf(input.resolved, input.fileOfSpecifier),
    variables,
  );
  if (unspellable(spelled)) {
    return {
      ...subject,
      refused:
        `the return type of \`${item.binding.name}\` cannot be written here: ${spelled.unspellable}`,
    };
  }

  return { ...subject, annotation: spelled.text, edits: writeEdits(spelled.text) };
}

/**
 * What makes this function's inferred type provisional, phrased to follow "the
 * body of `f` …", or nothing when the type can be trusted.
 *
 * Inference does not stop at a mistake: a call to a name that does not exist
 * still yields a type, and it is usually an unconstrained variable, so the
 * repair on offer would be `: a` — a claim of polymorphism that is an artifact
 * of the mistake and becomes wrong the moment the mistake is fixed. Writing it
 * is worse than writing nothing, because an annotation is rigid and the next
 * compilation then blames the signature instead of the missing name.
 *
 * Three questions, because the diagnostics can only answer the first.
 *
 * **Is anything wrong inside the declaration?** Any error the file reports
 * within the declaration's span is about this function — head as well as body.
 * The head matters for the same reason the body does, and it is a mistake to
 * think otherwise: an unknown *parameter* type is not a local complaint about
 * one word, because the checker gives that parameter a fresh variable and the
 * result generalizes over it. `m(x: I) = [x]` — a user two keystrokes into
 * `Int` — infers `Vector(a)`, which is not wrong about the text on screen and is
 * wrong about every text the user is on their way to. Writing it down turns a
 * finished word into `` `a` is a declared type variable, but the body requires
 * `Int` ``, blaming a signature the user did not write for a typo they already
 * fixed.
 *
 * The exception is the errors that report the missing signature itself — the
 * annotations and the constraints that cannot be declared without them. Those
 * are the absence of the very thing being written, so neither is a reason to
 * refuse to write it, and each carries `incompleteSignature` to say so.
 *
 * They are skipped by that mark and not by where they sit, because *many* errors
 * report at a declaration's name and only these two are answered by writing a
 * signature. `` `m` is already bound `` reports there and is a real reason to
 * wait: a rebinding conflict leaves the body's type unresolved, so the repair
 * would be `: a` and wrong once the conflict is settled. So does exposing a
 * private type through an exported binding. A span test cannot tell any of them
 * apart, and reading the message text would make a sentence a user reads into an
 * interface this query depends on.
 *
 * The other two are about the same thing — *did the parser get through it?* —
 * and neither can be asked of the diagnostics, because a declaration that stops
 * parsing takes its own report with it: `#parseItems` reports at whatever token
 * it stopped on and then *synchronizes forward*, so the complaint lands outside
 * the declaration, where nothing about its position or width tells it apart from
 * a complaint about the file.
 *
 * **Did the body run off the end?** `= {a = x` leaves a group **open**. Valid
 * code balances its brackets and a truncated body does not, while a stray `@@@`
 * on the line between two declarations leaves every bracket alone.
 *
 * **Did the declaration end where a declaration may end?** `= x, y)` is a tuple
 * missing its opening parenthesis: the body parses as `x`, the rest is
 * abandoned, and `Int` is not the type of what is being written. This is asked
 * of *layout*, because `#parseItems` asks layout too — after an item it accepts
 * `VSep`, `Semicolon`, `VClose` or the end, and anything else is "expected a
 * newline or `;` between block items" followed by `#synchronize` eating the
 * remains. The test here is that same one over that same stream.
 *
 * Asking layout rather than reasoning about lines is the whole point, and it
 * took several attempts to learn. A comma or a closing bracket at the start of a
 * line is an `expressionContinuations` token (`layout.ts`), so **no** separator
 * is emitted before it and `= x\n, y)` is the same abandonment as `= x, y)` —
 * where a rule about same-line tokens concludes the opposite, and a rule
 * enumerating which leftovers look suspicious concludes something else again.
 *
 * One consequence is a decision rather than a side effect: a *finished* body
 * followed by a stray `}` on the next line is refused too. It is the same event
 * — the parser stopped making sense of the file there and swallowed whatever
 * came next — and no test on token positions can separate the two, because
 * `= x\n)` and `= x\n) ++ "a"` differ only in what follows the token the parser
 * stopped at. A repair derived from a file the compiler gave up reading is the
 * one worth waiting on.
 *
 * The last two questions are asked of the body alone. An unclosed *parameter
 * list* is not a broken type, it is a missing place to put one, and
 * `insertionPlan` refuses it in those terms.
 */
function unsettledBy(
  diagnostics: readonly Diagnostics.Diagnostic[],
  lexed: Lexed.File,
  laidOut: LaidOut.File,
  item: Resolved.FunItem | Resolved.LetItem,
  lambda: Resolved.LambdaExpr,
): string | undefined {
  const name = item.binding.name;
  const body = lambda.body.span.start.offset;
  const from = item.span.start.offset;
  const to = item.span.end.offset;
  for (const diagnostic of diagnostics) {
    // Errors only, for now because there is nothing else: no compiler pass emits
    // a warning today. The day one does, it must not take a repair away — a
    // warning is by definition something the user may leave alone.
    if (diagnostic.severity !== "error") continue;
    if (diagnostic.incompleteSignature === true) continue;
    const { start, end } = diagnostic.primary;
    if (start.offset >= from && end.offset <= to) {
      // Not "so the type is not settled": a JavaScript-spelled comment in the
      // body is an error whose own repair is offered beside this one and whose
      // presence says nothing about the type. The claim made here is only that
      // something here needs fixing, which is what being in the declaration is.
      const where = start.offset >= body ? "body" : "signature";
      return `the ${where} of \`${name}\` has an error to fix first: ${diagnostic.message}`;
    }
  }
  // Over the body alone. Widening it to the whole declaration changes no answer
  // — an unclosed group in the head either leaves `insertionPlan` with no `)` to
  // write after, or carries a parse error the loop above has already returned on
  // — so the narrower region is the one that matches what the sentence says.
  const unclosed = unclosedGroupIn(lexed, body, to);
  if (unclosed !== undefined) {
    return `the body of \`${name}\` has an unclosed \`${unclosed}\`, ` +
      "so its type is not settled yet";
  }
  return separated(laidOut, item.span.end.offset)
    ? undefined
    : `the parser could not carry on past \`${name}\`, so its type is not settled yet`;
}

/**
 * Whether a declaration ending at this offset is followed by something that ends
 * a declaration: the test `#parseItems` makes, on the stream it makes it on.
 *
 * `VSep` and `VClose` are layout's, `Semicolon` is written, and running out is
 * the last declaration in a file. Anything else is a token the item did not take
 * and the parser will not accept — and text that does not lex at all leaves no
 * token, so a stray `@@@` is not this question's business: nothing was
 * abandoned, and the lexer has already said so in its own words.
 */
function separated(laidOut: LaidOut.File, end: number): boolean {
  // Skipping `VClose` is the whole of getting the *depth* right, and getting it
  // wrong made this question inert for every function with an indented body.
  // A declaration's span ends at its body's last item (`#parseBlock` sets the
  // block's span from its contents, not from its closer), so the tokens between
  // there and the parser's decision are the closers for blocks this declaration
  // opened — which `#parseBlock` consumes before returning. `#parseItems` sees
  // the first token after those.
  const next = laidOut.tokens.find(
    (token) => token.span.start.offset >= end && token.kind !== "VClose",
  )?.kind;
  // Every laid-out stream ends with `Eof`, so a missing answer cannot happen;
  // if it ever did, "not separated" is the safe reading of it.
  return next === "VSep" || next === "Semicolon" || next === "Eof";
}

/**
 * The innermost bracket left open across a region, if any. Innermost because it
 * is the one a reader is closest to: in `= [{a = x` the `[` is context and the
 * `{` is where they are typing.
 */
function unclosedGroupIn(lexed: Lexed.File, from: number, to: number): string | undefined {
  const openers: string[] = [];
  for (const token of lexed.tokens) {
    const { span } = token;
    if (span.start.offset < from || span.end.offset > to) continue;
    // A string is one token however much punctuation it holds, and an
    // interpolation's tokens are nested inside it, so neither a brace in a
    // string nor one in an interpolation is seen here. Comments are not tokens
    // at all.
    switch (token.kind) {
      case "LeftParen":
        openers.push("(");
        break;
      case "LeftBracket":
        openers.push("[");
        break;
      case "LeftBrace":
        openers.push("{");
        break;
      case "RightParen":
      case "RightBracket":
      case "RightBrace":
        // Popped without matching kinds: the question is only whether anything
        // is left open. A closer with no opener is a mismatch the parser has
        // already reported inside this same region, which the caller checks
        // first.
        openers.pop();
        break;
      default:
        break;
    }
  }
  return openers.at(-1);
}

/** A function declaration and the lambda it binds. */
interface FunctionDeclaration {
  readonly item: Resolved.FunItem | Resolved.LetItem;
  readonly lambda: Resolved.LambdaExpr;
}

/**
 * The function whose *declared name* covers this offset, when it has not written
 * a return type.
 *
 * Keyed on the name rather than on the whole declaration because that is where
 * the diagnostic this answers puts its caret, so a request driven by one lands
 * exactly here — and today every request is, since `codeActions` passes a
 * diagnostic's own start offset. The end is inclusive so that a caret just past
 * a name counts as being on it, which is what every other position query here
 * does and what a request made from a cursor rather than a diagnostic will
 * need.
 */
function functionAt(
  resolved: Resolved.Module,
  offset: number,
): FunctionDeclaration | undefined {
  for (const item of resolved.items) {
    // Every `Fun` and `Let` in this list was written in this file, so the
    // offsets below are comparable without checking. The one item the resolver
    // injects is the prelude *import* (Modules §5.5), which this loop has
    // already passed over by kind — and which carries the whole module as its
    // span, so it would match every offset if it ever stopped being an import.
    if (item.kind !== "Fun" && item.kind !== "Let") continue;
    if (offset < item.binding.span.start.offset || offset > item.binding.span.end.offset) continue;
    const lambda = item.kind === "Fun"
      ? item.value
      : item.value.kind === "Lambda"
        ? item.value
        : undefined;
    if (lambda === undefined || lambda.returnAnnotation !== undefined) return undefined;
    return { item, lambda };
  }
  return undefined;
}

/**
 * Where the annotation goes, read from the token stream.
 *
 * The tree does not record it: the annotation belongs after the parameter list's
 * closing parenthesis, which is not part of any parameter and has no node of its
 * own. What the tree does give is the *lambda*, whose span begins exactly at the
 * parameter list — at the `(` where there is one, and at the sole parameter
 * where the source omitted it (Functions §3.1). So the tokens from there to the
 * body are read, and the arrow introducing the body — `=` for a header, `=>` for
 * a lambda literal, the same node either way (Functions §3.2) — is the last one
 * in that window. What sits immediately before it closes the parameter list.
 *
 * Anchoring on the lambda rather than searching back from the arrow is what
 * keeps a parameter *pattern* from being misread: `{a = p} => p` contains an `=`
 * of its own, and hunting for one to mark the start of the parameters put the
 * open parenthesis inside the record pattern.
 *
 * Raw tokens rather than the laid-out stream on purpose: layout inserts virtual
 * delimiters, and every position here has to be one a user could put a cursor
 * on. Comments are not tokens, so a comment between the parameters and the arrow
 * stays where the user put it.
 *
 * A single parameter may omit its parentheses, and there is then nowhere for the
 * colon to go, since the return annotation is defined as following the parameter
 * list. Those parentheses are written too, around exactly the span the lambda
 * says its parameters occupy.
 *
 * Whether they are there already is asked of the *first parameter* rather than
 * of the token before the arrow. A parameter is a pattern (Pattern Matching
 * §6.5) and a pattern can end in a parenthesis of its own — `Box(v) => v` binds
 * one constructor pattern and no parameter list — so reading a closing
 * parenthesis as evidence of a list wrote `Box(v): a => v`, which is not a
 * program. A list that has parentheses opened them before its first parameter;
 * a bare pattern did not.
 */
function insertionPlan(
  lexed: Lexed.File,
  lambda: Resolved.LambdaExpr,
): ((annotation: string) => readonly Diagnostics.Edit[]) | undefined {
  const fileId = lambda.span.fileId;
  const from = lambda.span.start.offset;
  const to = lambda.body.span.start.offset;
  const window = lexed.tokens.filter(({ span }) =>
    span.start.offset >= from && span.end.offset <= to
  );
  const arrow = lastIndexOf(window, ({ kind }) => kind === "FatArrow" || kind === "Equal");
  if (arrow === undefined) return undefined;
  const before = window[arrow - 1];
  if (before === undefined) return undefined;
  // An insertion is an empty span, and it carries the token's own position
  // rather than a fresh one: a host renders a span by its line and column, so a
  // point built from an offset alone would be reported at the top of the file.
  const at = (point: Source.Position): Source.Span => ({ fileId, start: point, end: point });

  // Zero parameters can only be written `()`, so a list with nothing in it has
  // its parentheses by construction.
  const first = lambda.parameters[0];
  const parenthesized = first === undefined ||
    window.some(({ kind, span }) =>
      kind === "LeftParen" && span.start.offset < first.span.start.offset
    );
  if (parenthesized) {
    // The tree says there is a list and the tokens say it never closed, which is
    // an ordinary state to be in halfway through typing one: `fun f(x: Int = x`.
    // There is no place for a colon until it closes.
    if (before.kind !== "RightParen") return undefined;
    return (annotation) => [{ span: at(before.span.end), replacement: `: ${annotation}` }];
  }
  return (annotation) => [
    { span: at(lambda.span.start), replacement: "(" },
    { span: at(before.span.end), replacement: `): ${annotation}` },
  ];
}

function lastIndexOf<T>(items: readonly T[], matches: (item: T) => boolean): number | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (matches(items[index]!)) return index;
  }
  return undefined;
}
