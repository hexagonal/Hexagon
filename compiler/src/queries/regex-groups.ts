/**
 * *(`regex.md` §5, §8.)* What an editor says about the groups of a literal
 * handed to `Regex.compile`: hover on a group or the literal, and each group's
 * number as an inlay hint at its `(`.
 *
 * Every answer here reads the groups the program's own `Regex.Syntax` parsed
 * (`CompiledProject.regexGroups`): which `(` opens which group is the parser's
 * to say, and nothing here reads the pattern for itself. A literal the build
 * refused has no groups to show; its report and fixes stand in their place.
 */
import type { CompiledModule } from "../project.js";
import { literalCodepoints, sourceSpelling, type RegexGroup } from "../regex-literals.js";
import type * as Source from "../support/source.js";

/** The literal a position is in, with its codepoints' source text and its groups. */
interface Literal {
  readonly span: Source.Span;
  readonly pattern: readonly string[];
  readonly codepoints: readonly (readonly [number, number])[];
  readonly groups: readonly RegexGroup[];
}

type Site = CompiledModule["javascript"]["regexLiterals"][number];

/** The `compile` literal `site` of `module`, where the parser read its pattern. */
function literalOf(
  module: CompiledModule,
  site: Site,
  groupsOf: (pattern: string) => readonly RegexGroup[] | undefined,
): Literal | undefined {
  if (site.span.fileId !== module.source.id) return undefined;
  const located = literalCodepoints(module.source.text, site.span.start.offset, site.span.end.offset);
  const pattern = [...site.pattern];
  // A literal whose source does not spell its pattern codepoint for
  // codepoint has no place to put an answer.
  if (located === undefined || located.codepoints.length !== pattern.length) return undefined;
  const groups = groupsOf(site.pattern);
  return groups === undefined ? undefined : { span: site.span, pattern, codepoints: located.codepoints, groups };
}

/**
 * A group's text, spelled as a string literal writes it (§8): as a report
 * quotes a pattern, whatever escapes the literal itself uses.
 */
function writtenText(literal: Literal, group: RegexGroup): string {
  return sourceSpelling(literal.pattern.slice(group.start - 1, group.start - 1 + group.length).join(""));
}

/**
 * `text` as one Markdown code span, its fence longer than any run of backticks
 * in it. Nothing here begins or ends with a backtick: a group's text runs from
 * `(` to `)`, and a name is letters, digits and `_`.
 */
function code(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map(([run]) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${text}${fence}`;
}

/** How a match reads `group`: by name where it has one, and by number. */
function readBy(group: RegexGroup): string {
  const byNumber = code(`m.group(${group.index})`);
  return group.name === undefined
    ? byNumber
    : `${code(`m.named(${JSON.stringify(group.name)})`)} or ${byNumber}`;
}

/** A group's line: its number, its name where it has one, and its text. */
function groupLine(literal: Literal, group: RegexGroup): string {
  const name = group.name === undefined ? "" : `, ${code(group.name)}`;
  return `group ${group.index}${name}: ${code(writtenText(literal, group))}`;
}

/** What hover says inside a `compile` literal: its span, and the Markdown it shows. */
export interface RegexHover {
  readonly span: Source.Span;
  readonly documentation: string;
}

/**
 * Hover at `offset` inside a `compile` literal of `module`. On a group, the
 * innermost capturing group whose `(` through `)` holds the offset: its
 * number, its name, its text, and how a match reads it. Elsewhere in the
 * literal, quotes included, its groups in order.
 */
export function regexHoverAt(
  file: Source.File,
  module: CompiledModule,
  groupsOf: (pattern: string) => readonly RegexGroup[] | undefined,
  offset: number,
): RegexHover | undefined {
  // Only the literal under the offset is parsed.
  const site = module.javascript.regexLiterals
    .find(({ span }) => span.start.offset <= offset && offset < span.end.offset);
  const literal = site === undefined ? undefined : literalOf(module, site, groupsOf);
  if (literal === undefined) return undefined;
  // The codepoint at the offset, 1-based; 0 on a quote, which no group holds.
  const at = literal.codepoints.findIndex(([from, to]) => from <= offset && offset < to) + 1;
  // Groups nest, and a later one that holds the position is inside an earlier
  // one that does: the last is the innermost.
  const group = literal.groups.findLast(({ start, length }) => start <= at && at < start + length);
  if (group !== undefined) {
    const from = literal.codepoints[group.start - 1]![0];
    const to = literal.codepoints[group.start + group.length - 2]![1];
    return {
      span: file.span(from, to),
      documentation: `${groupLine(literal, group)}\n\nRead it with ${readBy(group)}.`,
    };
  }
  const count = literal.groups.length;
  const documentation = count === 0
    ? "No capturing groups."
    : [
      `${count === 1 ? "One capturing group" : `${count} capturing groups`}, in the order \`Regex.group\` numbers them:`,
      "",
      ...literal.groups.map((each) => `- ${groupLine(literal, each)}`),
    ].join("\n");
  return { span: literal.span, documentation };
}

/** One group's number, to show just before its `(`. */
export interface RegexGroupHint {
  /** The source offset of the group's `(`. */
  readonly offset: number;
  readonly label: string;
  /** The group's hover, for the hint's tooltip. */
  readonly tooltip: string;
}

/** Each capturing group's number, at its `(`, for every `compile` literal of `module`. */
export function regexGroupHints(
  module: CompiledModule,
  groupsOf: (pattern: string) => readonly RegexGroup[] | undefined,
): RegexGroupHint[] {
  return module.javascript.regexLiterals.flatMap((site) => {
    const literal = literalOf(module, site, groupsOf);
    return literal === undefined ? [] : literal.groups.map((group) => ({
      offset: literal.codepoints[group.start - 1]![0],
      label: String(group.index),
      tooltip: `${groupLine(literal, group)}\n\nRead it with ${readBy(group)}.`,
    }));
  });
}
