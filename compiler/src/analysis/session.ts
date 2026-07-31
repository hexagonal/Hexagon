/**
 * A persistent analysis session: the compiler-side service an editor talks to.
 *
 * `compileProject` is a batch: hand it every file, get a whole project back. An
 * editor instead holds a file set that changes one keystroke at a time and asks
 * questions about positions. This class is the adapter between those two shapes,
 * and it is the API `language-server/README.md` reserves for the compiler — the
 * server owns the protocol, this owns the language.
 *
 * It is deliberately free of any filesystem or process API. The host decides
 * what a workspace contains and pushes text in; the session never reads a file.
 *
 * ## Positions
 *
 * Every position crossing this API is a UTF-16 offset into the named file, which
 * is the compiler's own coordinate system (`Source.File`). Converting an editor's
 * line/character pair happens once, in the host, so this layer never carries two
 * coordinate systems at the same time.
 *
 * ## Staleness
 *
 * Analysis is recomputed lazily and wholly: any file change discards it, and the
 * next question rebuilds it. `version` increments on every mutation, so a host
 * that started a request before an edit can tell that the answer it is holding
 * no longer describes the text the user is looking at.
 *
 * Whole-project recompilation is the deliberate starting point rather than a
 * placeholder. Reanalyzing the whole standard library after an edit measures
 * around 19ms, which is inside a keystroke's budget, so incremental reuse would
 * buy nothing yet and would have to guess at what is worth keeping before any
 * query exists to say. When a real workspace makes that false, the seam is here:
 * only `#analyze` decides what to rebuild.
 */

import * as Diagnostics from "../support/diagnostics.js";
import * as Source from "../support/source.js";
import type * as Lexed from "../syntax/lexed/index.js";
import type * as Resolved from "../syntax/resolved/index.js";
import { lex } from "../passes/lexer/lexer.js";
import {
  compileProject,
  resolveSpecifier,
  type CompiledModule,
  type ProjectOptions,
} from "../project.js";
import {
  collectOccurrences,
  targetKey,
  type Occurrence,
  type Target,
} from "../queries/occurrences.js";
import { collectTypeOccurrences, type TypeOccurrence } from "../queries/type-occurrences.js";
import { collectSemanticTokens, type SemanticToken } from "../queries/semantic-tokens.js";
import { collectSymbolFacts, type SymbolFacts } from "../queries/symbol-facts.js";
import { collectCompletions, type Completion } from "../queries/completions.js";

/** A span together with the path of the file it lies in. */
export interface Location {
  readonly path: string;
  readonly span: Source.Span;
}

export interface Definition extends Location {
  readonly target: Target;
  readonly name: string;
}

export interface Reference extends Location {
  readonly target: Target;
  readonly name: string;
  readonly isDefinition: boolean;
}

export interface Hover {
  readonly name: string;
  readonly target: Target;
  /** Present for values the checker gave a scheme; absent for types themselves. */
  readonly displayedType?: string;
  /** The identifier the answer describes, for the editor to highlight. */
  readonly span: Source.Span;
}

/**
 * A rename the session will not perform, with the reason to show the user.
 *
 * A refusal is a result, not an error: every one of them describes something the
 * user can act on — a name the project does not own, a spelling Hexagon will not
 * read as the same kind of name, an edit that would change what the code means.
 * Silently doing the rename anyway is the failure mode this type exists to
 * prevent, because a rename is the one request whose damage is invisible until
 * much later.
 */
export interface RenameRefusal {
  readonly refused: string;
}

/** One span to replace, and the file it lies in. */
export interface RenameEdit extends Location {}

export interface RenamePlan {
  readonly newName: string;
  /** Ordered by file, then by position; never overlapping. */
  readonly edits: readonly RenameEdit[];
}

export type RenameResult = RenamePlan | RenameRefusal;

/** The identifier a rename would start from, for the editor to pre-fill. */
export interface RenameSubject {
  readonly name: string;
  readonly span: Source.Span;
}

export function refused(result: RenameResult | RenameSubject): result is RenameRefusal {
  return "refused" in result;
}

export interface SessionOptions extends ProjectOptions {}

export class AnalysisSession {
  #options: SessionOptions;
  readonly #texts = new Map<string, string>();
  /**
   * One identity per path, held even across a removal. Spans are compared by
   * file id all through the compiler, so a path that changed identity whenever
   * it was closed and reopened would make two spans in the same file look like
   * spans in different ones. Staleness is `version`'s job, not the id's.
   */
  readonly #fileIds = new Map<string, Source.FileId>();
  #nextFileId = 0;
  #version = 0;
  #analysis: Analysis | undefined;

  constructor(options: SessionOptions = {}) {
    this.#options = options;
  }

  /** Increments on every file-set mutation; stable while only queries run. */
  get version(): number {
    return this.#version;
  }

  /**
   * Replaces the compilation options.
   *
   * A host usually learns what kind of project it has *after* opening a session
   * on it — the configuration is a file in the workspace, so it has to be read
   * like any other — and that file can then change while the session is open.
   * Options are therefore not fixed at construction. Changing them invalidates
   * analysis exactly as a file change does, because they can change what every
   * answer is: `runtimePaths` decides which modules may name `Node(a)` at all.
   */
  configure(options: SessionOptions): void {
    if (sameOptions(this.#options, options)) return;
    this.#options = options;
    this.#invalidate();
  }

  get paths(): readonly string[] {
    return [...this.#texts.keys()];
  }

  /** Adds a file or replaces its text. A no-op change still invalidates nothing. */
  setFile(path: string, text: string): void {
    const normalized = normalizePath(path);
    if (this.#texts.get(normalized) === text) return;
    this.#texts.set(normalized, text);
    if (!this.#fileIds.has(normalized)) {
      this.#fileIds.set(normalized, Source.fileId(this.#nextFileId));
      this.#nextFileId += 1;
    }
    this.#invalidate();
  }

  removeFile(path: string): void {
    const normalized = normalizePath(path);
    if (!this.#texts.delete(normalized)) return;
    this.#invalidate();
  }

  /**
   * The path a compiler file identity belongs to. Spans name files by number,
   * so a host rendering a span that points somewhere else — a diagnostic's
   * secondary label, most often — needs this to say where.
   */
  pathOfFile(fileId: Source.FileId): string | undefined {
    return this.#analyze().pathOf(fileId);
  }

  /** Diagnostics for one file, empty for a file the session does not hold. */
  diagnostics(path: string): readonly Diagnostics.Diagnostic[] {
    return this.#analyze().diagnosticsByPath.get(normalizePath(path)) ?? [];
  }

  /**
   * Diagnostics for every file the session holds, including the files that
   * produced none. A host publishing diagnostics needs the empty entries too:
   * they are how an editor learns that a file's previous errors are gone.
   */
  allDiagnostics(): ReadonlyMap<string, readonly Diagnostics.Diagnostic[]> {
    const analysis = this.#analyze();
    const result = new Map<string, readonly Diagnostics.Diagnostic[]>();
    for (const path of this.#texts.keys()) {
      result.set(path, analysis.diagnosticsByPath.get(path) ?? []);
    }
    return result;
  }

  /**
   * Where the name at this offset is declared.
   *
   * More than one answer is possible and correct: a record name denotes both a
   * type and its constructor, and a constraint name can in principle be declared
   * in several modules. Returning both beats picking one silently.
   */
  definitions(path: string, offset: number): readonly Definition[] {
    const analysis = this.#analyze();
    const found: Definition[] = [];
    const seen = new Set<string>();
    for (const occurrence of analysis.occurrencesAt(normalizePath(path), offset)) {
      for (const definition of analysis.byTarget(occurrence.target)) {
        if (definition.role !== "definition") continue;
        const key = `${targetKey(definition.target)}@${spanKey(definition.span)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          target: definition.target,
          name: definition.name,
          path: analysis.pathOf(definition.span.fileId) ?? "",
          span: definition.span,
        });
      }
    }
    return found.filter(({ path: found }) => found !== "");
  }

  /** Every occurrence of what the name at this offset denotes, declaration included. */
  references(
    path: string,
    offset: number,
    options: { readonly includeDeclaration?: boolean } = {},
  ): readonly Reference[] {
    const includeDeclaration = options.includeDeclaration ?? true;
    const analysis = this.#analyze();
    const found: Reference[] = [];
    const seen = new Set<string>();
    for (const occurrence of analysis.occurrencesAt(normalizePath(path), offset)) {
      for (const other of analysis.byTarget(occurrence.target)) {
        const isDefinition = other.role === "definition";
        if (isDefinition && !includeDeclaration) continue;
        const key = `${targetKey(other.target)}@${spanKey(other.span)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const owner = analysis.pathOf(other.span.fileId);
        if (owner === undefined) continue;
        found.push({ target: other.target, name: other.name, path: owner, span: other.span, isDefinition });
      }
    }
    return found.sort((left, right) =>
      left.path.localeCompare(right.path) ||
      left.span.start.offset - right.span.start.offset
    );
  }

  /**
   * What the name at this offset is. When several occurrences share the offset —
   * a record's name is its type and its constructor — the one carrying a type
   * wins, because that is the answer with something to say.
   */
  hover(path: string, offset: number): Hover | undefined {
    const normalized = normalizePath(path);
    const analysis = this.#analyze();
    const candidates = analysis.occurrencesAt(normalized, offset);
    if (candidates.length === 0) return undefined;
    const typed = candidates
      .map((occurrence) => ({
        occurrence,
        displayedType: analysis.displayedTypeAt(normalized, occurrence.span),
      }))
      .sort((left, right) => Number(right.displayedType !== undefined) - Number(left.displayedType !== undefined));
    const best = typed[0]!;
    return {
      name: best.occurrence.name,
      target: best.occurrence.target,
      span: best.occurrence.span,
      ...(best.displayedType === undefined ? {} : { displayedType: best.displayedType }),
    };
  }

  /**
   * What each name in one file means, for colouring by resolution.
   *
   * Empty for a file the session does not hold, which is the same answer a file
   * with no names gives — an editor that asked about a file this session has
   * never seen should get its grammar's colours, not an error.
   */
  semanticTokens(path: string): readonly SemanticToken[] {
    const analysis = this.#analyze();
    return collectSemanticTokens(
      analysis.occurrencesIn(normalizePath(path)),
      analysis.symbolFacts,
    );
  }

  /**
   * What could be written at this offset.
   *
   * Answered against whatever the last analysis produced, which for a buffer
   * mid-keystroke is a tree with errors in it — that is the normal case for this
   * request rather than a degraded one, and the scope record survives it because
   * the resolver writes each region down as it opens it.
   */
  completions(path: string, offset: number): readonly Completion[] {
    const normalized = normalizePath(path);
    const text = this.#texts.get(normalized);
    if (text === undefined) return [];
    const analysis = this.#analyze();
    const resolved = analysis.resolvedOf(normalized);
    if (resolved === undefined) return [];
    return collectCompletions({ text, offset, resolved, facts: analysis.symbolFacts });
  }

  /**
   * The identifier a rename at this offset would rewrite, or the reason it
   * cannot be.
   *
   * `undefined` and a refusal are different answers and the host must keep them
   * apart: `undefined` means there is no name here, where an editor should say
   * nothing at all, while a refusal means there is one and something is wrong
   * with renaming it, which the user needs told.
   */
  prepareRename(path: string, offset: number): RenameSubject | RenameRefusal | undefined {
    const subject = this.#renameSubject(path, offset);
    if (subject === undefined || "refused" in subject) return subject;
    return { name: subject.name, span: subject.span };
  }

  /**
   * Every edit that renaming the name at this offset would make, or the reason
   * the session will not make them.
   */
  rename(path: string, offset: number, newName: string): RenameResult | undefined {
    const subject = this.#renameSubject(path, offset);
    if (subject === undefined || "refused" in subject) return subject;
    if (newName === subject.name) return { newName, edits: [] };

    const spelling = checkNewName(subject.name, newName);
    if (spelling !== undefined) return spelling;

    const byPath = new Map<string, Source.Span[]>();
    for (const mention of subject.mentions) {
      const bucket = byPath.get(mention.path);
      if (bucket === undefined) byPath.set(mention.path, [mention.span]);
      else bucket.push(mention.span);
    }
    for (const spans of byPath.values()) {
      spans.sort((left, right) => left.start.offset - right.start.offset);
    }

    const objection = this.#verifyRename(subject.name, byPath, newName);
    if (objection !== undefined) return objection;

    return {
      newName,
      edits: [...byPath]
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([owner, spans]) => spans.map((span) => ({ path: owner, span }))),
    };
  }

  /**
   * What a rename at this offset would move: the identities under the cursor and
   * every mention of them this project owns.
   */
  #renameSubject(path: string, offset: number): SubjectOfRename | RenameRefusal | undefined {
    const analysis = this.#analyze();
    const innermost = analysis.occurrencesAt(normalizePath(path), offset)[0];
    if (innermost === undefined) return undefined;
    const name = innermost.name;
    // One offset can carry more than one identity — a record's name is its type
    // and its constructor — and both have to move, or the declaration stops
    // agreeing with itself.
    const targets = analysis
      .occurrencesAt(normalizePath(path), offset)
      .filter((occurrence) => occurrence.name === name)
      .map(({ target }) => target);
    const mentions: RenameEdit[] = [];
    const seen = new Set<string>();
    // Asked of every spelling, not only the one under the cursor. An alias's
    // declaration is spelled differently *by definition* — that is what makes it
    // an alias — so testing the filtered set would report `import {two as deux}`
    // as having no declaration and refuse a rename that is perfectly ordinary.
    const declared = targets.some((target) =>
      analysis.byTarget(target).some(({ role }) => role === "definition")
    );
    for (const target of targets) {
      for (const occurrence of analysis.byTarget(target)) {
        // An alias gives one identity two spellings. `import {Shade as Other}`
        // makes `Other` a mention of `Shade`, but renaming `Shade` must leave it
        // alone: the clause goes on aliasing, it just aliases a declaration that
        // is now spelled differently. Restricting to the spelling under the
        // cursor is exactly what makes each of the two sets complete on its own,
        // rather than making this a partial rename.
        if (occurrence.name !== name) continue;
        const owner = analysis.pathOf(occurrence.span.fileId);
        if (owner === undefined) continue;
        if (!this.#texts.has(owner)) {
          return {
            refused:
              `\`${name}\` is declared in \`${owner}\`, which this project does not own`,
          };
        }
        const key = `${owner}@${occurrence.span.start.offset}:${occurrence.span.end.offset}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mentions.push({ path: owner, span: occurrence.span });
      }
    }
    // `Eq`, `Ord`, `Show` and `Hash` are known to the checker rather than
    // declared in Hexagon, so every mention of one is a reference and there is
    // nothing to rewrite. Renaming them would silently detach every instance.
    if (!declared) {
      return { refused: `\`${name}\` is built into the compiler, so it has no declaration to rename` };
    }
    return { name, span: innermost.span, targets, mentions };
  }

  /**
   * Re-analyses the project with the rename applied, and refuses unless the
   * result means exactly what the original did.
   *
   * This is why a rename from this session can be trusted, and it is
   * deliberately not a scope calculation. Working out by hand which binder a
   * moved name would fall under means writing Hexagon's scoping rules a second
   * time, in a place nothing keeps honest — the copy that matters is the
   * resolver's. So the edit is made and the compiler is asked what it now sees.
   *
   * Two things have to hold. **No diagnostic may appear that was not there
   * before**: Statements §5.1 makes most collisions an error, so this catches
   * them in the compiler's own words rather than in a paraphrase. And **the
   * renamed identity's mentions must be exactly the spans that were rewritten**
   * — no more, no fewer. That second test is the one that matters, because
   * capture produces no diagnostic at all: if a use now falls under a different
   * binder, or a name nobody touched now falls under this one, the two sets stop
   * matching and the rename is refused instead of quietly changing the program.
   */
  #verifyRename(
    name: string,
    byPath: ReadonlyMap<string, readonly Source.Span[]>,
    newName: string,
  ): RenameRefusal | undefined {
    const probe = new AnalysisSession(this.#options);
    for (const [owner, text] of this.#texts) {
      const spans = byPath.get(owner);
      probe.setFile(owner, spans === undefined ? text : replaceSpans(text, spans, newName));
    }

    const before = diagnosticTally(this.allDiagnostics());
    for (const [key, appearance] of diagnosticTally(probe.allDiagnostics())) {
      if ((before.get(key)?.count ?? 0) >= appearance.count) continue;
      return {
        refused:
          `renaming \`${name}\` to \`${newName}\` would break \`${appearance.path}\`: ` +
          appearance.message,
      };
    }

    // Where each rewritten span ends up. Edits within one file shift everything
    // after them by the same amount each, since the spans are sorted and cannot
    // overlap. Lines do not move: an identifier replaces an identifier, and
    // neither contains a line break.
    interface Site {
      readonly path: string;
      readonly line: number;
      readonly start: number;
      readonly end: number;
    }
    const expected = new Map<string, Site>();
    const delta = newName.length - name.length;
    for (const [owner, spans] of byPath) {
      spans.forEach((span, index) => {
        const start = span.start.offset + delta * index;
        const site: Site = { path: owner, line: span.start.line, start, end: start + newName.length };
        expected.set(siteKey(site), site);
      });
    }

    const analysis = probe.#analyze();
    const targets: Target[] = [];
    const known = new Set<string>();
    for (const site of expected.values()) {
      const here = analysis
        .occurrencesAt(site.path, site.start)
        .filter(({ span }) => span.start.offset === site.start && span.end.offset === site.end);
      if (here.length === 0) {
        return {
          refused:
            `renaming \`${name}\` to \`${newName}\` could not be verified: ` +
            `\`${site.path}\` line ${site.line + 1} no longer holds a name the compiler recognizes`,
        };
      }
      for (const occurrence of here) {
        const identity = targetKey(occurrence.target);
        if (known.has(identity)) continue;
        known.add(identity);
        targets.push(occurrence.target);
      }
    }

    const reached = new Map<string, Site>();
    for (const target of targets) {
      for (const occurrence of analysis.byTarget(target)) {
        // Same alias rule as when the mentions were gathered: a clause that goes
        // on aliasing under its old local name is not a mention that moved.
        if (occurrence.name !== newName) continue;
        const owner = analysis.pathOf(occurrence.span.fileId);
        if (owner === undefined) continue;
        const site: Site = {
          path: owner,
          line: occurrence.span.start.line,
          start: occurrence.span.start.offset,
          end: occurrence.span.end.offset,
        };
        reached.set(siteKey(site), site);
      }
    }

    // Only the excess direction can fail, and that is not an oversight: the
    // targets were collected *from* the rewritten spans, so every one of them is
    // in its own target's occurrence set and `expected` is a subset of `reached`
    // by construction. What the comparison is really asking is whether the
    // rename swept anything else in — a binder the moved name now falls under,
    // or a name nobody touched that now means the renamed declaration. Either
    // way some span that is not one of ours ended up sharing the identity.
    for (const site of reached.values()) {
      if (expected.has(siteKey(site))) continue;
      return {
        refused:
          `renaming \`${name}\` to \`${newName}\` would change what the code means: ` +
          `\`${site.path}\` line ${site.line + 1} already has a \`${newName}\`, and the ` +
          "rename would merge the two",
      };
    }
    return undefined;
  }

  #invalidate(): void {
    this.#version += 1;
    this.#analysis = undefined;
  }

  #analyze(): Analysis {
    if (this.#analysis === undefined) {
      const files = [...this.#texts].map(([path, text]) =>
        new Source.File(this.#fileIds.get(path)!, path, text)
      );
      this.#analysis = new Analysis(compileProject(files, this.#options));
    }
    return this.#analysis;
  }
}

/** One whole-project compilation, indexed for position and identity lookup. */
class Analysis {
  readonly diagnosticsByPath = new Map<string, Diagnostics.Diagnostic[]>();
  readonly #pathsByFileId = new Map<number, string>();
  readonly #occurrencesByPath = new Map<string, readonly Occurrence[]>();
  readonly #resolvedByPath = new Map<string, Resolved.Module>();
  readonly #occurrencesByTarget = new Map<string, Occurrence[]>();
  readonly #typesByPath = new Map<string, Map<string, TypeOccurrence>>();
  /** Gathered once for the whole project — see `collectSymbolFacts`. */
  readonly symbolFacts: ReadonlyMap<number, SymbolFacts>;

  constructor(project: { readonly modules: readonly CompiledModule[]; readonly diagnostics: readonly Diagnostics.Diagnostic[] }) {
    this.symbolFacts = collectSymbolFacts(project.modules);
    // Built before the indexing loop: an import may name a module compiled after
    // this one, and a type name in an import list can only be resolved once the
    // specifier's target file is known.
    const fileIdsByPath = new Map(
      project.modules.map((module) => [module.source.path, module.source.id]),
    );
    for (const module of project.modules) {
      const path = module.source.path;
      this.#pathsByFileId.set(Number(module.source.id), path);
      const occurrences = collectOccurrences(module, {
        fileOfSpecifier: (specifier) => fileIdsByPath.get(resolveSpecifier(path, specifier)),
      });
      this.#occurrencesByPath.set(path, occurrences);
      this.#resolvedByPath.set(path, module.resolved);
      for (const occurrence of occurrences) {
        const key = targetKey(occurrence.target);
        const bucket = this.#occurrencesByTarget.get(key);
        if (bucket === undefined) this.#occurrencesByTarget.set(key, [occurrence]);
        else bucket.push(occurrence);
      }
      this.#typesByPath.set(
        path,
        new Map(
          collectTypeOccurrences(module.typed).map((type) => [spanKey(type.span), type]),
        ),
      );
    }
    // A diagnostic belongs to the file its primary span names, which is not
    // always the file being edited: a module rejects an import by pointing at
    // its own text, but a checker error can caret a declaration a dependency
    // owns. Grouping by the span keeps each diagnostic where a user can see it.
    for (const diagnostic of project.diagnostics) {
      const path = this.#pathsByFileId.get(Number(diagnostic.primary.fileId));
      if (path === undefined) continue;
      const bucket = this.diagnosticsByPath.get(path);
      if (bucket === undefined) this.diagnosticsByPath.set(path, [diagnostic]);
      else bucket.push(diagnostic);
    }
  }

  pathOf(fileId: Source.FileId): string | undefined {
    return this.#pathsByFileId.get(Number(fileId));
  }

  /** One file's occurrences in source order, empty for a file not compiled. */
  occurrencesIn(path: string): readonly Occurrence[] {
    return this.#occurrencesByPath.get(path) ?? [];
  }

  /** One file's resolved tree, absent for a file that was not compiled. */
  resolvedOf(path: string): Resolved.Module | undefined {
    return this.#resolvedByPath.get(path);
  }

  /**
   * Occurrences covering an offset, innermost first. The range is half-open at
   * the end *except* that the caret sitting just past an identifier still counts
   * as being on it, which is where an editor leaves the cursor after typing a
   * name and where users expect a request to answer.
   */
  occurrencesAt(path: string, offset: number): readonly Occurrence[] {
    const occurrences = this.#occurrencesByPath.get(path) ?? [];
    return occurrences
      .filter(({ span }) => offset >= span.start.offset && offset <= span.end.offset)
      .sort((left, right) =>
        (left.span.end.offset - left.span.start.offset) -
        (right.span.end.offset - right.span.start.offset)
      );
  }

  byTarget(target: Target): readonly Occurrence[] {
    return this.#occurrencesByTarget.get(targetKey(target)) ?? [];
  }

  displayedTypeAt(path: string, span: Source.Span): string | undefined {
    return this.#typesByPath.get(path)?.get(spanKey(span))?.displayedType;
  }
}

function spanKey(span: Source.Span): string {
  return `${Number(span.fileId)}:${span.start.offset}:${span.end.offset}`;
}

/** What `#renameSubject` works out, of which only part is the host's business. */
interface SubjectOfRename extends RenameSubject {
  readonly targets: readonly Target[];
  /** Every mention this project owns, spelled as the cursor spells it. */
  readonly mentions: readonly RenameEdit[];
}

function siteKey(site: { readonly path: string; readonly start: number; readonly end: number }): string {
  return `${site.path}@${site.start}:${site.end}`;
}

/**
 * Whether a proposed spelling is a name at all, and the same *kind* of name as
 * the one it replaces — decided by lexing both rather than by restating
 * `spec/lexer.md` §3 here.
 *
 * The lexer is where a keyword, the reserved `__hex_` prefix, and the
 * capitalized/uncapitalized split are actually decided. A copy of those rules in
 * this file would be one more thing to keep in step, and the copy is the one
 * that would silently fall behind — which is how `TRésultat` came to truncate to
 * `TR` in the first slice's index.
 */
function checkNewName(current: string, proposed: string): RenameRefusal | undefined {
  const token = soleNameToken(proposed);
  if (token === undefined) {
    return {
      refused:
        `\`${proposed}\` is not a name Hexagon can read: it has to be one identifier, ` +
        "and not a keyword",
    };
  }
  const existing = soleNameToken(current);
  if (existing === undefined || existing.kind === token.kind) return undefined;
  const [capitalized, plain] = token.kind === "UpperName"
    ? [proposed, current]
    : [current, proposed];
  return {
    refused:
      `\`${capitalized}\` starts with a capital letter and \`${plain}\` does not. ` +
      "Hexagon reads those as two different kinds of name, so this would not be " +
      "a rename but a different declaration",
  };
}

/** The one name token a string consists of, or nothing if it is anything else. */
function soleNameToken(candidate: string): Lexed.NameToken | undefined {
  const lexed = lex(new Source.File(Source.fileId(0), "<name>", candidate));
  if (lexed.diagnostics.length > 0) return undefined;
  const [token, ...rest] = lexed.tokens;
  if (token === undefined) return undefined;
  if (token.kind !== "NonUpperName" && token.kind !== "UpperName") return undefined;
  // Whitespace lexes to nothing, so `"foo "` produces the same single token as
  // `"foo"`; comparing the text is what tells them apart. Anything else that
  // lexed — `a b`, `a.b` — leaves a token behind after the name.
  if (token.text !== candidate) return undefined;
  return rest.every(({ kind }) => kind === "Eof") ? token : undefined;
}

/** Replaces spans back to front, so an earlier edit cannot move a later one. */
function replaceSpans(
  text: string,
  spans: readonly Source.Span[],
  replacement: string,
): string {
  let result = text;
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index]!;
    result = result.slice(0, span.start.offset) + replacement + result.slice(span.end.offset);
  }
  return result;
}

/**
 * How many times each diagnostic is reported against each file, counted rather
 * than collected: a rename shifts positions, so two runs are compared by what
 * they say and where, never by the exact span they said it at.
 */
function diagnosticTally(
  all: ReadonlyMap<string, readonly Diagnostics.Diagnostic[]>,
): ReadonlyMap<string, { readonly path: string; readonly message: string; count: number }> {
  const tally = new Map<string, { path: string; message: string; count: number }>();
  for (const [path, diagnostics] of all) {
    for (const { severity, message } of diagnostics) {
      const key = `${path} ${severity} ${message}`;
      const entry = tally.get(key);
      if (entry === undefined) tally.set(key, { path, message, count: 1 });
      else entry.count += 1;
    }
  }
  return tally;
}

/**
 * Whether two option sets would compile the same way. Order within
 * `runtimePaths` is not meaningful — `compileProject` reads it as a set — so
 * reordering must not throw away analysis a host is about to ask questions of.
 *
 * The destructuring is load-bearing rather than stylistic. A field added to
 * `ProjectOptions` and not handled here would compare equal to itself forever:
 * `configure` would return early, the host would get answers from the old
 * options, and nothing would report it — the worst shape a cache bug takes.
 * Binding the rest to `Record<string, never>` makes that a compile error at the
 * moment the field is added, which is the only moment anyone is looking.
 */
function sameOptions(left: SessionOptions, right: SessionOptions): boolean {
  const compared = ({ runtimePaths, ...rest }: SessionOptions): readonly string[] => {
    const exhaustive: Record<string, never> = rest;
    void exhaustive;
    return [...(runtimePaths ?? [])].sort();
  };
  const [before, after] = [compared(left), compared(right)];
  return before.length === after.length && before.every((path, at) => path === after[at]);
}

/**
 * The compiler's module graph resolves specifiers against `/`-separated paths,
 * so a host on Windows has to arrive in that shape. Normalizing here rather than
 * asking every caller to keeps one spelling of a file inside the session.
 */
function normalizePath(path: string): string {
  const absolute = path.startsWith("/") || path.replaceAll("\\", "/").startsWith("/");
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}
