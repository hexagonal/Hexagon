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
  readonly #occurrencesByTarget = new Map<string, Occurrence[]>();
  readonly #typesByPath = new Map<string, Map<string, TypeOccurrence>>();

  constructor(project: { readonly modules: readonly CompiledModule[]; readonly diagnostics: readonly Diagnostics.Diagnostic[] }) {
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

/**
 * Whether two option sets would compile the same way. Order within
 * `runtimePaths` is not meaningful — `compileProject` reads it as a set — so
 * reordering must not throw away analysis a host is about to ask questions of.
 */
function sameOptions(left: SessionOptions, right: SessionOptions): boolean {
  const paths = (options: SessionOptions): readonly string[] =>
    [...(options.runtimePaths ?? [])].sort();
  const [before, after] = [paths(left), paths(right)];
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
