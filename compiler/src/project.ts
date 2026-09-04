/** Whole-project orchestration for Hexagon's acyclic relative module graph. */

import * as Diagnostics from "./support/diagnostics.js";
import { relativeSpecifier } from "./support/paths.js";
import * as Source from "./support/source.js";
import type * as Parsed from "./syntax/parsed/index.js";
import type * as Resolved from "./syntax/resolved/index.js";
import type * as Typed from "./syntax/typed/index.js";
import type * as Core from "./syntax/core/index.js";
import type * as Emitted from "./emission/index.js";
import { lex } from "./passes/lexer/lexer.js";
import { applyLayout } from "./passes/layout/layout.js";
import { parseFile } from "./passes/parser/parser.js";
import {
  displayModuleName,
  firstSegmentPackage,
  fullModuleName,
  moduleImportLine,
  moduleLayoutPath,
  resolveModuleName,
  STANDARD_LIBRARY,
  type ModuleIndex,
  type ModuleResolution,
  type ProgramModule,
  type ProgramPackage,
} from "./packages.js";
import { internalNameInputs, moduleInterface, resolve } from "./passes/resolver/resolver.js";
import {
  check,
  homeCompanionOperations,
  type ProgramOperation,
} from "./passes/checker/checker.js";
import { elaborate } from "./passes/elaborator/elaborator.js";
import {
  emitDeclarations,
  emitJavaScript,
  emittedModuleSpecifier,
  type NominalHome,
  nominalHomeKey,
  runtimeDeclarationsText,
  runtimeGlobalsText,
  RUNTIME_DECLARATIONS_STEM,
  RUNTIME_WIRINGS,
} from "./passes/emitter/emitter.js";
import {
  fundamentalInstancesOf,
  preludeBoolUnion,
  type FundamentalInstances,
} from "./passes/emitter/specializations.js";
import type { ModuleImport, PreludeImport } from "./passes/resolver/resolver.js";
import type { RuntimeLocations } from "./passes/emitter/emitter.js";
import { PRELUDE_MODULES, PRIMITIVE_COMPANION_BASENAMES } from "./prelude.js";
import { RUNTIME_MODULES } from "./runtime-modules.js";

export interface CompiledModule {
  readonly source: Source.File;
  /**
   * The module's **full name** (Packages §2.3) — its identity (Modules §1).
   * `Main`, `Render.Geometry`, `Hex.Option`.
   */
  readonly name: string;
  /**
   * Where this module's emitted files go, relative to the output root, as a
   * `.hex` path: the full name laid out as a path (Packages §6). The compiler's
   * internal address for the module, and what every emitted specifier is
   * computed from. Not a source path — a source file's name and place appear
   * nowhere in the output.
   */
  readonly path: string;
  readonly parsed: Parsed.Module;
  readonly resolved: Resolved.Module;
  readonly typed: Typed.Module;
  readonly core: Core.Module;
  readonly javascript: Emitted.JavaScript;
  readonly declarations: Emitted.Declarations;
  /**
   * Where this module's emission found each runtime module, so a host that
   * re-emits it (the Playground, for its private-specialization preview) gets
   * the same answer rather than the same-directory default.
   *
   * Carried rather than recomputed because only `compileProject` knows where
   * the runtime modules were injected, and a host that guessed would emit a
   * runtime module with no export list, or a consumer importing a path that
   * does not exist — both of which compile clean and fail at load.
   */
  readonly runtimes: RuntimeLocations;
  /**
   * The specifier this module spells the program's runtime module by (FFI Part 7
   * §1.2), source-form — carried for `runtimes`' reason exactly: only
   * `compileProject` knows the source common root and the stem §8.3's probe
   * settled there, and a host that re-emits the module (the Playground) would
   * otherwise write an import of a path that is not there.
   */
  readonly runtimeGlobalsSpecifier: string;
}

/**
 * One module through elaboration, before emission — `CompiledModule` minus the
 * two emitted artefacts. See `checked` in `compileProject` for why the compile
 * has a seam here at all.
 */
type CheckedModule = Omit<CompiledModule, "javascript" | "declarations">;

/**
 * Whether a module is an injected one the host should treat as compiler-owned
 * rather than as the user's source: the prelude members and the runtime
 * modules. A host presenting declarations, bindings, or an outline lists what
 * the user wrote, and these are not that.
 */
export function isInjectedModule(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return PRELUDE_MODULES.some((module) => module.basename === basename) ||
    RUNTIME_MODULES.some((module) => module.basename === basename);
}

export interface CompiledProject {
  readonly modules: readonly CompiledModule[];
  /**
   * The program's runtime declaration module (FFI Part 1 §8.3), or `undefined`
   * when no generated `.d.ts` mentions a `Hex.*` face.
   *
   * This is the first emission artefact belonging to no source file, which is
   * why it sits beside `modules` rather than inside one: the compiled project
   * was strictly per-module until §8.3 needed a program-scoped seat, and
   * obligation 3 is what grows it. The compile stays filesystem-free — the
   * artefact carries its intended path for a host to write it to. No host in
   * this repo does; see `Emitted.RuntimeDeclarations` for what that means.
   */
  readonly runtimeDeclarations: Emitted.RuntimeDeclarations | undefined;
  /**
   * The program's runtime module (FFI Part 7 §1.2), or `undefined` when no
   * module of it binds a runtime-vocabulary spelling.
   *
   * The seat beside `runtimeDeclarations`, sharing its stem and its program
   * scope, and independent of it: a program can owe either, both, or neither.
   * Unlike its type-only sibling this artefact is **executable** — a host that
   * materializes only source-derived modules loses every contested program at
   * its first import, so an execution set must carry it like a prelude module.
   */
  readonly runtimeGlobals: Emitted.RuntimeGlobals | undefined;
  /**
   * Algorithm S's candidate rows for the pre-registered constraints, read off
   * this program's prelude (#679, `fundamentalInstancesOf`).
   *
   * Carried out for the reason `CompiledModule.runtimes` is: a host that
   * re-emits a module — the Playground, for its inspection preview — has to
   * plan the same editions the shipped emission planned, and only the compile
   * that ran the prelude can say which those are.
   */
  readonly fundamentalInstances: FundamentalInstances;
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

export interface ProjectOptions {
  /**
   * Paths compiled as privileged **runtime** modules — the ones allowed to spell
   * `Node(a)` (`resolve`'s `runtime` flag). Separate from prelude privilege,
   * which follows the injection path. A runtime module still sees the prelude,
   * which is what lets it name `Bool` at all since #147 made `Bool` a prelude
   * declaration rather than a primitive.
   */
  readonly runtimePaths?: readonly string[];
  /**
   * The project's manifest `name` (Packages §2.5), where it has one. A project
   * that is never published needs none: its own modules are addressed by their
   * declared names alone, and it never qualifies them by its own name.
   */
  readonly packageName?: string;
  /**
   * The Hexagon packages the project's manifest lists (Packages §2.1). In this
   * slice the compiler reads no `node_modules`, so a listed name contributes to
   * the **package set** — which Modules §2.2's first-segment rule reads — and
   * supplies no modules; resolving an installed package to its source is the
   * host layer's, and additive.
   */
  readonly dependencies?: readonly string[];
}

/** One module of the program, as `compileProject` addresses it. */
interface Unit {
  readonly source: Source.File;
  readonly parsed: Parsed.Module;
  readonly packageName: string | undefined;
  readonly declaredName: string;
  readonly fullName: string;
  /** The canonical layout path — this module's address (Packages §6). */
  readonly path: string;
  readonly injected: "prelude" | "runtime" | undefined;
  /** Seat in the injected order, for §5.5's visible-prefix slice. */
  readonly seat: number | undefined;
}

/** Compiles every supplied file in dependency-first order without filesystem access. */
export function compileProject(
  files: readonly Source.File[],
  options: ProjectOptions = {},
): CompiledProject {
  const runtimePaths = new Set((options.runtimePaths ?? []).map(normalizePath));
  const diagnostics = new Diagnostics.Bag();
  const projectPackage: ProgramPackage = {
    name: options.packageName,
    dependencies: options.dependencies ?? [],
  };
  const sourceFiles = files.map((file) =>
    file.path === normalizePath(file.path)
      ? file
      : new Source.File(file.id, normalizePath(file.path), file.text)
  );
  // One injected list, prelude and runtime members woven together, in the order
  // that makes each see the members before it and only those (Modules §5.5, and
  // `RuntimeModule.precedes` for what the runtime seats decide).
  const injectedModules = weaveInjected(PRELUDE_MODULES, RUNTIME_MODULES);
  const units = gatherModules(sourceFiles, projectPackage, injectedModules);
  const injectedUnits = units.filter(({ injected }) => injected !== undefined)
    .sort((left, right) => left.seat! - right.seat!);
  const preludeUnits = injectedUnits.filter(({ injected }) => injected === "prelude");
  const preludePaths = preludeUnits.map(({ path }) => path);
  const preludeSet = new Set(preludePaths);
  const runtimeModuleSet = new Set(
    injectedUnits.filter(({ injected }) => injected === "runtime").map(({ path }) => path),
  );
  /** Each injected path's seat, for the "sees only what precedes it" slice. */
  const injectedSeats = new Map(injectedUnits.map(({ path, seat }) => [path, seat!]));
  /**
   * Where each wired runtime module was seated, by basename. A wiring whose
   * module is absent from the project — which is only an empty project — has no
   * entry, and emission falls back to the same-directory default.
   */
  const runtimeModulePathsByBasename = new Map(
    RUNTIME_WIRINGS.flatMap(({ basename }) => {
      const unit = injectedUnits.find(({ injected, declaredName }) =>
        injected === "runtime" && `${declaredName}.hex` === basename
      );
      return unit === undefined ? [] : [[basename, unit.path] as const];
    }),
  );
  // The runtime declaration module's stem, settled before any module is emitted
  // because every importer has to spell the same one (FFI Part 1 §8.3).
  const runtimeBasename = runtimeDeclarationsBasename(units);

  const sourcePaths = new Set(sourceFiles.map(({ path }) => path));
  const byPath = new Map(units.map((unit) => [unit.path, unit]));
  const index = moduleIndexOf(units, diagnostics, projectPackage);
  const parsed = new Map(units.map((unit) => [unit.path, unit.parsed]));
  const sources = new Map(units.map((unit) => [unit.path, unit.source]));

  /**
   * The edges each module's imports name, keyed by the **written spelling** —
   * the key `resolve` reads them back by (Modules §2.3). A written name that
   * resolved to nothing has no entry: it was refused here, where the package
   * set is known, and binds no alias (§5.2).
   */
  const importEdges = new Map<string, Map<string, string>>();
  for (const unit of units) {
    const edges = new Map<string, string>();
    importEdges.set(unit.path, edges);
    for (const item of unit.parsed.items) {
      if (
        (item.kind === "ExternBlock" || item.kind === "ExternImport") &&
        (item.specifier.startsWith("./") || item.specifier.startsWith("../")) &&
        sourcePaths.has(resolveSpecifier(unit.source.path, item.specifier))
      ) {
        diagnostics.add({
          severity: "error",
          message: "use `import` for Hexagon modules; `extern from` is for foreign JavaScript",
          primary: item.span,
        });
        continue;
      }
      if (item.kind !== "Import") continue;
      if (edges.has(item.module.text)) continue;
      const resolution = resolveModuleName(item.module.text, packageOf(unit, projectPackage), index);
      if (resolution.kind === "Resolved") {
        edges.set(item.module.text, moduleLayoutPath(resolution.module.fullName));
        continue;
      }
      // A **derived** name is the parser's recovery of a refused head (Modules
      // §3.1): the line already carries its rewrite, and the module the
      // specifier's basename names may well not exist. Reporting it unresolved
      // would answer a question the author never asked.
      if (!item.module.declared) continue;
      diagnostics.add({
        severity: "error",
        message: unresolvedModuleMessage(item.module.text, resolution),
        primary: item.span,
      });
    }
  }

  const ordered: string[] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    const cycleStart = visiting.indexOf(path);
    if (cycleStart >= 0) {
      const module = byPath.get(path);
      if (module !== undefined) {
        diagnostics.add({
          severity: "error",
          // Modules §8.1: the cycle is named by its modules, never by files.
          message: `import cycle: ${
            [...visiting.slice(cycleStart), path]
              .map((member) => displayModuleName(byPath.get(member)?.fullName ?? member))
              .join(" -> ")
          }`,
          primary: module.parsed.span,
        });
      }
      return;
    }
    const module = byPath.get(path);
    if (module === undefined) return;
    visiting.push(path);
    for (const target of importEdges.get(path)?.values() ?? []) visit(target);
    visiting.pop();
    visited.add(path);
    ordered.push(path);
  };
  for (const unit of units) visit(unit.path);
  // Prelude modules compile before their consumers, and their identities live in a
  // reserved high range so consumer ids stay stable whether or not a prelude is present.
  // The runtime modules sit among them on both counts, for the same reasons: a
  // module has to compile behind everything it sees, and a project's own symbol
  // ids must not shift because the compiler injects a trie the project may not
  // even reach.
  const injectedPaths = injectedUnits.map(({ path }) => path);
  for (const path of injectedPaths) {
    const index = ordered.indexOf(path);
    if (index >= 0) ordered.splice(index, 1);
  }
  ordered.unshift(...injectedPaths);

  const compiled = new Map<string, CompiledModule>();
  /**
   * Every module through elaboration, before any of them is emitted.
   *
   * The compile is two passes over `ordered` rather than one, and the boundary
   * is what the specialization planner's candidate judgment needs (#679): the
   * fundamental instances a pre-registered constraint holds are a fact about the
   * **prelude**, not about what the module being planned happens to see, and a
   * prelude module sees only the members before its own seat (Modules §5.5). In
   * one interleaved pass `Nat.hex` would be emitted knowing `Int.hex`'s rows and
   * nothing later, and would plan a different edition set for its own exports
   * than every consumer recomputes for them (`planImportedSpecializations`) —
   * an importer emitting a call to a name the exporter never published.
   *
   * Splitting here answers it with the real machinery and no second copy of the
   * truth: the rows are read off the prelude's own checked `honor` items, once
   * every one of them exists, and handed to every emission as one
   * program-invariant table.
   *
   * What that does **not** buy is freedom from the seat order. The table settles
   * what a module *plans*; the module still has to **resolve** what it plans,
   * and an edition at a primitive carries `Primitive` evidence that
   * `#emitEvidence` resolves from the emitting module's own channels. A prelude
   * module planning an edition at a fundamental whose companion sits after its
   * own seat reports a compiler defect — measured on `stdlib/Ord.hex`, where one
   * added constrained export mints five editions and produces five of them. The
   * seat order is load-bearing for that, loudly rather than silently, and
   * `conformance/derived-fundamental-candidates.test.ts` asserts the obligation
   * over every module a project emits.
   *
   * Nothing else moved across the boundary. The second pass reads only what the
   * first stored plus tables the first completed, and the one table emission
   * shared with the first pass — `nominalHomes` — is now complete for every
   * module rather than complete-as-far-as-this-one, which is a difference no
   * emission can see: a face can only carry a nominal declared in a module
   * compiled before it, imports being acyclic, so every entry a module could
   * reach was already there.
   */
  const checked = new Map<string, CheckedModule>();
  // Every nominal the program has resolved, dependencies first. `ordered` is a
  // topological order and imports are acyclic (Modules §8), so a declaration is
  // in here before anything that could name it — and, because a type reference
  // can only follow an import, no cross-module strongly-connected component can
  // form behind the analysis's back. Only the variance analysis reads it; see
  // `Declarations` in `passes/checker/variance.ts` for why one module's own view
  // is the wrong source.
  const programNominals: { unions: Resolved.Union[]; records: Resolved.RecordDeclaration[] } = {
    unions: [],
    records: [],
  };
  // Method Syntax §4.2's companion operation set for every nominal the program
  // has declared, dependencies first, each contributed by the type's own home
  // module (#585, `homeCompanionOperations`). The section's "the set is
  // import-insensitive… by construction" is this table: a checker reads a
  // receiver's operations from here, so no import of the *call site's* can add
  // one or take one away. Ordering carries the completeness claim — a type
  // nameable in a module had its home module compiled before it, because
  // imports are acyclic and a type reference can only follow one — which is what
  // makes the transitive case work: a nominal reached through a re-export or
  // through an imported function's result arrives with its whole set, having
  // never been imported here at all.
  const programOperations = new Map<string, Map<string, ProgramOperation>>();
  /**
   * FFI Part 7 §2.4 rung 5's table: every **exported** nominal the program
   * declares, by identity, with the module that declares it.
   *
   * `programOperations`' shape one field narrower, and gathered the same way —
   * from each module's own items as it is compiled, dependencies first — because
   * the question is the same one: which module *owns* this identity, asked from
   * a module that may never have imported it. A declaration file's minted import
   * is the one channel that has to name a module the source never mentioned, so
   * this is the only place the answer can come from.
   *
   * Exported only. A minted `import type { Hidden }` of a name its home module
   * withholds would resolve to nothing; §2.4 fences the shapes that reach a
   * private nominal to #621, and the sink declines there and prints the declared
   * name — the pre-existing behaviour — rather than writing an import that
   * cannot bind.
   */
  const nominalHomes = new Map<string, NominalHome>();
  let symbolBase = 0;
  let unionBase = 0;
  let recordBase = 0;
  let externTypeBase = 0;
  let preludeSymbolBase = PRELUDE_ID_BASE;
  let preludeUnionBase = PRELUDE_ID_BASE;
  let preludeRecordBase = PRELUDE_ID_BASE;
  let preludeExternTypeBase = PRELUDE_ID_BASE;
  for (const path of ordered) {
    const isPrelude = preludeSet.has(path);
    const isRuntimeModule = runtimeModuleSet.has(path);
    // Both injected sets take their identities from the reserved range, so a
    // project's own ids are what a compilation with neither would have given it.
    const isInjected = isPrelude || isRuntimeModule;
    const source = sources.get(path)!;
    const parsedModule = parsed.get(path)!;
    // Keyed by the **written spelling** (Modules §2.3), carrying the specifier
    // the emitter writes — computed from the two modules' full names and their
    // package directories (§11.2, Packages §6), because the source wrote none.
    const imports = new Map<string, ModuleImport>();
    const importedSchemes = new Map<Resolved.SymbolId, Typed.Scheme>();
    for (const [written, target] of importEdges.get(path) ?? []) {
      const dependency = checked.get(target);
      if (dependency === undefined) continue;
      imports.set(written, {
        interface: moduleInterface(dependency.resolved),
        specifier: relativeSpecifier(path, target),
        name: byPath.get(target)!.fullName,
      });
      for (const symbol of dependency.typed.symbols) {
        importedSchemes.set(symbol.id, symbol.scheme);
      }
    }
    // Consumers see every prelude module; an *injected* module sees the members
    // before its own seat, and only those (Modules §5.5). Ordering the set this
    // way is what makes cycles impossible by construction, and it is why the
    // list order is normative rather than incidental. An injected module never
    // sees itself or anything later, so the first member sees nothing — and a
    // runtime module is bound by the same rule, which is what keeps
    // `VectorTrie.hex` from naming the `Vector` its own emission serves.
    const seat = injectedSeats.get(path);
    const preludeVisible = seat === undefined
      ? preludePaths
      : preludePaths.filter((preludePath) => injectedSeats.get(preludePath)! < seat);
    const preludeImports: PreludeImport[] = preludeVisible.flatMap((preludePath) => {
      const preludeCompiled = checked.get(preludePath);
      if (preludeCompiled === undefined) return [];
      for (const symbol of preludeCompiled.typed.symbols) {
        importedSchemes.set(symbol.id, symbol.scheme);
      }
      return [{
        interface: moduleInterface(preludeCompiled.resolved),
        specifier: relativeSpecifier(path, preludePath),
        name: byPath.get(preludePath)!.fullName,
      }];
    });
    const unit = byPath.get(path)!;
    const resolved = resolve(parsedModule, {
      // This module's **address** — its full name laid out as a path (Packages
      // §6), which is the only source of `Resolved.Module.path` and of the
      // `declaringPath` every nominal declared here is stamped with. Those
      // travel so a diagnostic can name another *module*; the name is what a
      // report prints, and the address is what specifier arithmetic reads.
      path,
      // The same fact read the other way round: what this module *is*, for
      // Exceptions §7.1's brand (#488) — its **full name** (Packages §2.3), so
      // the prelude's `Vector` brands `Hex.Vector` wherever its file sits and
      // the brand is a property of the module rather than of a directory.
      identity: unit.fullName,
      // Modules §5.5's refusal quotes the program back to itself; nothing else
      // reads the text.
      text: source.text,
      imports,
      symbolBase: isInjected ? preludeSymbolBase : symbolBase,
      unionBase: isInjected ? preludeUnionBase : unionBase,
      recordBase: isInjected ? preludeRecordBase : recordBase,
      externTypeBase: isInjected ? preludeExternTypeBase : externTypeBase,
      // Standard-library privilege — the intrinsic door's gate
      // (`spec/intrinsics.md` §5.2). It follows the *path*, so a project
      // supplying its own file at an injection path is privileged in it: the
      // stdlib-developing-itself path, carrying the same trust model as the
      // `Node` runtime flag precedent.
      //
      // Two seats hold it. Prelude membership is the first. The **runtime
      // module set** is the second (§5.2's runtime bullet, #365) — by either
      // route it arrives by, injection at the basename or the host's
      // `runtimePaths` grant, which is the same disjunction the `runtime` flag
      // below is computed from and for the same reason. A runtime module is
      // already trusted enough to spell `Node`; the door lets its new operations
      // arrive as declared, key-verified rows instead of as growth in the
      // non-declared guard family.
      //
      // The two privileges stay **separate flags**, not one merged notion:
      // `runtime` puts a name in scope and `privileged` opens a declaration
      // form, and a prelude member holds the second without the first.
      privileged: isPrelude || runtimePaths.has(unit.source.path) || isRuntimeModule,
      // A primitive's home module is its fixed prelude companion (Constraints
      // §5.3), and nothing in the module's text can say so — a primitive has no
      // declaration. Like the privilege above, the fact follows the *path*.
      ...(isPrelude && PRIMITIVE_COMPANION_BASENAMES.has(`${unit.declaredName}.hex`)
        ? {
          companionPrimitive: PRIMITIVE_COMPANION_BASENAMES.get(
            `${unit.declaredName}.hex`,
          )! as Resolved.PrimitiveName,
        }
        : {}),
      // The `Node(a)` privilege is the other one, and a runtime module holds it
      // by being one. A host may still grant it by path (`hexagon.json`), which
      // is how `runtime/VectorTrie.hex` compiles under its own repository path
      // rather than at the injection basename.
      ...(runtimePaths.has(unit.source.path) || isRuntimeModule ? { runtime: true } : {}),
      ...(preludeImports.length === 0 ? {} : { prelude: preludeImports }),
    });
    if (isInjected) {
      preludeSymbolBase = nextId(resolved.symbols.map(({ id }) => Number(id)), preludeSymbolBase);
      preludeUnionBase = nextId(resolved.unions.map(({ id }) => Number(id)), preludeUnionBase);
      preludeRecordBase = nextId(resolved.records.map(({ id }) => Number(id)), preludeRecordBase);
      preludeExternTypeBase = nextId(
        resolved.externTypes.map(({ externType }) => Number(externType)),
        preludeExternTypeBase,
      );
    } else {
      // Prelude identities are reserved above PRELUDE_ID_BASE; excluding them keeps
      // each consumer's own id range identical to a prelude-free compilation.
      const local = (id: number): boolean => id < PRELUDE_ID_BASE;
      symbolBase = nextId(resolved.symbols.map(({ id }) => Number(id)).filter(local), symbolBase);
      unionBase = nextId(resolved.unions.map(({ id }) => Number(id)).filter(local), unionBase);
      recordBase = nextId(resolved.records.map(({ id }) => Number(id)).filter(local), recordBase);
      externTypeBase = nextId(
        resolved.externTypes.map(({ externType }) => Number(externType)).filter(local),
        externTypeBase,
      );
    }
    const typed = check(resolved, {
      importedSchemes,
      programNominals,
      programOperations,
      sourceText: source.text,
    });
    programNominals.unions.push(...resolved.unions);
    programNominals.records.push(...resolved.records);
    // Read from the module's own **items**, never from `resolved.unions` and its
    // siblings: those carry the imported copies too, so every module that named
    // a type would claim to be its home.
    for (const item of resolved.items) {
      if (item.kind === "Union" && item.exported) {
        nominalHomes.set(nominalHomeKey("union", Number(item.union)), { name: item.name, path });
      } else if (item.kind === "RecordDeclaration" && item.exported) {
        nominalHomes.set(nominalHomeKey("record", Number(item.record)), { name: item.name, path });
      } else if (item.kind === "ExternBlock") {
        for (const declaration of item.declarations) {
          if (declaration.kind !== "ExternType" || !declaration.exported) continue;
          nominalHomes.set(
            nominalHomeKey("externType", Number(declaration.externType)),
            { name: declaration.localName, path },
          );
        }
      }
    }
    // The schemes are this module's published ones, taken beside the symbols
    // rather than left for a consumer to look up: the operations that need the
    // table most are the ones no consumer imported, so no consumer holds their
    // schemes either.
    const publishedSchemes = new Map(typed.symbols.map(({ id, scheme }) => [id, scheme]));
    const ownOperations = homeCompanionOperations(resolved);
    // Computed once, and only where there is something to name: §8.2's added
    // import is written from the exporter's own spellings, and this is the
    // enumeration every written import already travels with.
    const ownInternalNames = ownOperations.size === 0
      ? { members: [], terms: [] }
      : internalNameInputs(moduleInterface(resolved));
    for (const [subject, operations] of ownOperations) {
      let seats = programOperations.get(subject);
      if (seats === undefined) {
        seats = new Map();
        programOperations.set(subject, seats);
      }
      for (const [name, symbol] of operations) {
        const scheme = publishedSchemes.get(symbol.id);
        if (scheme === undefined) continue;
        seats.set(name, { symbol, scheme, path, internalNames: ownInternalNames });
      }
    }
    // The source travels with the tree so the post-elaboration judgments can
    // quote what was written (Exceptions §5.4's cannot-throw message).
    const core = elaborate(typed, source);
    const runtimes = runtimesFor(path, runtimeModulePathsByBasename);
    // Source-form, like every other specifier emission is handed: the runtime
    // module sits at the **output root** under §8.3's probed stem, and a module
    // a directory down — a dotted name's, or a package's — spells it `../hex`
    // (FFI Part 7 §1.2; Packages §6).
    const runtimeGlobalsSpecifier = relativeSpecifier(path, `/${runtimeBasename}.hex`);
    checked.set(path, {
      source,
      name: unit.fullName,
      path,
      parsed: parsedModule,
      resolved,
      typed,
      core,
      runtimes,
      runtimeGlobalsSpecifier,
    });
  }

  // Algorithm S's candidate rows for the pre-registered constraints, read off
  // the prelude now that every prelude module has been checked (#679). One table
  // for the whole program, so an exporter's plan and every importer's
  // recomputation of it are the same function of the same input.
  //
  // The `Bool` pin comes from a prelude module that *sees* `Bool.hex` rather
  // than from `Bool.hex` itself, which cannot see its own declaration (Modules
  // §5.5). Any of them answers, and they answer the same identity.
  const preludeCores = preludePaths.flatMap((path) => {
    const module = checked.get(path);
    return module === undefined ? [] : [module.core];
  });
  const fundamentalInstances = fundamentalInstancesOf(
    preludeCores,
    preludeCores.map(preludeBoolUnion).find((id) => id !== undefined),
  );

  for (const path of ordered) {
    const module = checked.get(path);
    if (module === undefined) continue;
    const { source, parsed: parsedModule, resolved, typed, core, runtimes } = module;
    const { runtimeGlobalsSpecifier } = module;
    compiled.set(path, {
      source,
      name: module.name,
      path,
      parsed: parsedModule,
      resolved,
      typed,
      core,
      runtimes,
      runtimeGlobalsSpecifier,
      javascript: emitJavaScript(core, {
        exportInstanceEvidence: true,
        runtimes,
        runtimeGlobalsSpecifier,
        fundamentalInstances,
      }),
      declarations: emitDeclarations(core, {
        runtimeSpecifier: emittedModuleSpecifier(
          relativeSpecifier(path, `/${runtimeBasename}.hex`),
        ),
        nominalHomes,
        modulePath: path,
        fundamentalInstances,
      }),
    });
  }

  // Surface every module's own diagnostics on the project. `typed` accumulates
  // the lexing, layout, parsing, resolution, and checking stages; emission adds
  // its own. Without this a module that fails to compile reports success and
  // its broken JavaScript is handed back silently.
  // Each emission stage seeds its own bag with the diagnostics it was handed, so
  // `javascript` and `declarations` both re-carry everything `typed` produced and
  // a naive fold reports each one three times. The stages share diagnostic
  // *identity*, so a seen-set collapses the repeats without suppressing genuinely
  // distinct diagnostics that happen to read alike.
  const surfaced = new Set<Diagnostics.Diagnostic>();
  for (const path of ordered) {
    const module = compiled.get(path);
    if (module === undefined) continue;
    for (const stage of [module.typed, module.javascript, module.declarations]) {
      for (const diagnostic of stage.diagnostics) {
        if (surfaced.has(diagnostic)) continue;
        surfaced.add(diagnostic);
        diagnostics.add(diagnostic);
      }
    }
  }

  // Emit a prelude module only when something emitted imports it, so a project
  // that never touches its nominals is unchanged by the prelude's existence.
  // Since §5.5 lets prelude modules import each other, this is reachability
  // rather than a single hop: a module imported *only* by another prelude module
  // must still be emitted, or the emitted JavaScript carries an import of a file
  // that was never written — and that failure is silent, because the project
  // compiles clean.
  // `Import` items are not the whole answer since #153: a module that names only
  // a prelude *type* synthesizes no import item at all, yet its emission may
  // still import a dictionary from the prelude module that declares it. Those
  // edges are decided during emission, so they are read back from what emission
  // reported rather than inferred from the tree — the same shape as
  // `Declarations.importsRuntimeTypes`. Missing them is defect 8 exactly: an
  // emitted `import … from "./Hex/Prelude.js"` next to no `Prelude.js`, on a project
  // that reported no diagnostic.
  // A *synthesized* prelude import item is not an edge either, for the same
  // reason and since #263: its names are the resolver's over-approximation of
  // what companion dispatch might reach, and emission filters them to what the
  // body references — so the item can survive resolution with every name
  // dropped, and reading it as an edge would emit a prelude module nothing
  // imports. What emission reported is the answer for both channels.
  const importsOf = (path: string): readonly string[] => {
    const module = compiled.get(path);
    return [
      ...(module?.resolved.items ?? []).flatMap((item) =>
        item.kind === "Import" && !item.synthesized
          ? [resolveSpecifier(path, item.specifier)]
          : []
      ),
      ...[
        ...(module?.javascript.preludeInstanceImports ?? []),
        ...(module?.javascript.preludeTermImports ?? []),
        // The fundamental editions a known-concrete call site reaches (#440).
        // A fifth channel on the same footing, and the one that can be a
        // module's *only* edge: specializing every call to a prelude term
        // spends the synthesized import's whole name list, so the term channel
        // reports nothing while the emitted file still imports `logString`.
        ...(module?.javascript.specializationImports ?? []),
        // The member seats a concrete constraint-member call reaches (#444).
        // A sixth channel, and the one that can name a module no `Import` item
        // in this file mentions: an instance travels a re-export chain, but its
        // seats are only ever reached at the module that declared it.
        ...(module?.javascript.memberSeatImports ?? []),
        // The companion operations a dot call reached with no import to name
        // them by (#585, Method Syntax §8.2). A seventh channel on the same
        // footing as the sixth, and it can be a module's only edge to the
        // operation's home: §4.2's set is import-insensitive, so a type that
        // arrived through a re-export or a function's result carries its whole
        // companion, whose module nothing in this file mentions.
        ...(module?.javascript.companionOperationImports ?? []),
        // The home of an object-reading `extern enum` whose members this file
        // matches on (Foreign Enums §3). An eighth channel of the same kind, and
        // it can likewise be the only edge: Pattern Matching §2.2's door
        // resolves a constructor head against the expected type, so the match
        // need not have named the enum's module at all.
        ...(module?.javascript.enumMemberImports ?? []),
        // The `.d.ts` channel (#227, FFI Part 7 §2.4) is an edge on the same
        // footing, and the only one with no JavaScript counterpart: a face
        // naming `Option` while touching no `Option` term imports the type and
        // nothing else. Its target must still be emitted, or the declarations
        // import from a file that was never written.
        ...(module?.declarations.preludeTypeImports ?? []),
        // Rung 5's minted lines are edges of the same kind, and they reach
        // modules the source never imported at all (FFI Part 7 §2.4's
        // Reachability, extended by §14.3).
        ...(module?.declarations.mintedTypeImports ?? []),
        // The runtime modules (Collections Part 3 §4, Part 4 §2.1) are the
        // fourth such channel and the one with no `Import` item anywhere in the
        // program to fall back on: a runtime module exports nothing at the
        // Hexagon level, so emission's report is not merely the better answer,
        // it is the only one. A program that touches no `Vector(a)` reports no
        // `VectorTrie.js` and one that touches no `Map(k, v)` reports no
        // `HashTrie.js`.
        ...(module?.javascript.runtimeImports ?? []),
      ].map((specifier) => resolveSpecifier(path, specifier)),
    ];
  };
  const emitted = new Set(
    ordered.filter((path) => !preludeSet.has(path) && !runtimeModuleSet.has(path)),
  );
  const pending = [...emitted];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    for (const target of importsOf(path)) {
      if (emitted.has(target)) continue;
      emitted.add(target);
      pending.push(target);
    }
  }

  const modules = ordered.flatMap((path) => {
    if (!emitted.has(path)) return [];
    const module = compiled.get(path);
    return module === undefined ? [] : [module];
  });

  return {
    modules,
    // Present exactly when some emitted `.d.ts` imports it (FFI Part 1 §8.3
    // obligation 3). A module that was compiled but not emitted writes no file,
    // so its faces are not an importer — which is why this reads the emitted
    // list rather than every module compiled.
    runtimeDeclarations: modules.some(({ declarations }) => declarations.importsRuntimeTypes)
      ? {
          kind: "RuntimeDeclarations",
          path: `/${runtimeBasename}.d.ts`,
          text: runtimeDeclarationsText(),
        }
      : undefined,
    // Present exactly when some emitted module imports its reserved captures
    // (FFI Part 7 §1.2). Independent of the declaration module above and decided
    // the same way — over the *emitted* list, because an unemitted module writes
    // no file and so imports nothing — and, unlike it, load-bearing at run time:
    // a host's execution set must carry this one.
    runtimeGlobals: modules.some(({ javascript }) => javascript.importsRuntimeGlobals)
      ? {
          kind: "RuntimeGlobals",
          path: `/${runtimeBasename}.js`,
          text: runtimeGlobalsText(),
        }
      : undefined,
    fundamentalInstances,
    diagnostics: diagnostics.toArray(),
  };
}

/**
 * The stem the runtime declaration module claims at the **output root**: the
 * first free of `hex`, `hex1`, `hex2`, … (FFI Part 1 §8.3, as respelled by
 * #829).
 *
 * §10's probing discipline, lifted from identifiers to filenames: a user module
 * whose own emission claims `hex.js`/`hex.d.ts` **at that root** keeps its name
 * and the generated file moves. The comparison is case-insensitive because
 * case-colliding filesystems exist, and a program that compiled here and
 * overwrote a file there would be the worst possible way to find that out.
 *
 * The probe reads the **emitted filenames** — a module's declared name, laid
 * out (Packages §6) — never a source path, which appears nowhere in the output.
 * Only a module at the root can collide: a dotted name and a package's modules
 * emit into their own directories. The probe runs over every module, which is a
 * superset of the emitted ones, and the superset is the safe direction:
 * over-claiming only ever moves the generated file, which nothing outside this
 * compile names, while under-claiming would silently overwrite a user's.
 */
function runtimeDeclarationsBasename(units: readonly Unit[]): string {
  const claimed = new Set<string>();
  for (const { path } of units) {
    const directory = path.slice(0, Math.max(0, path.lastIndexOf("/")));
    if (directory !== "") continue;
    claimed.add(path.slice(path.lastIndexOf("/") + 1).replace(/\.hex$/, "").toLowerCase());
  }
  if (!claimed.has(RUNTIME_DECLARATIONS_STEM)) return RUNTIME_DECLARATIONS_STEM;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${RUNTIME_DECLARATIONS_STEM}${suffix}`;
    if (!claimed.has(candidate)) return candidate;
  }
}

/** The package a unit's imports resolve against (Packages §3.1). */
function packageOf(unit: Unit, project: ProgramPackage): ProgramPackage {
  return unit.packageName === project.name
    ? project
    // `Hex` sees itself and nothing else: the prelude's intra-set visibility is
    // Modules §5.5's ordered prefix, applied where the module is compiled.
    : { name: unit.packageName, dependencies: [] };
}

/**
 * Parses every source file into the modules it declares and seats the injected
 * `Hex` modules among them (Modules §2.2; Packages §2.2, §2.4).
 *
 * A project file **supplying** an injected module wins, as it always has — the
 * stdlib-developing-itself path. The test is now both halves of the identity:
 * the file sits at the injected basename *and* declares the injected name. One
 * half alone would either hijack a user's `module Option` on a file called
 * anything, or hand `Hex.Option`'s seat to a file called `Option.hex` that
 * declares something else.
 *
 * **Only `.hex` sources are modules** (Packages §2.2). A host hands the compiler
 * every file it has, and a `.js` beside them is a foreign target an
 * `extern from "./world.js"` names, not a Hexagon module: parsing it would ask
 * it for a `module` header it can never carry. It stays in the file list, where
 * the extern seats read it, and never becomes a unit. A package whose sources
 * hold no `.hex` file therefore has no modules at all, and injects nothing —
 * the same answer an empty project has always given, asked of the module set
 * rather than of the file list.
 */
function gatherModules(
  sourceFiles: readonly Source.File[],
  project: ProgramPackage,
  injectedModules: readonly InjectedModule[],
): readonly Unit[] {
  const seat = (
    source: Source.File,
    parsed: Parsed.Module,
    packageName: string | undefined,
    injected: Unit["injected"],
    index: number | undefined,
  ): Unit => {
    const fullName = fullModuleName(packageName, parsed.name.text);
    return {
      source,
      parsed,
      packageName,
      declaredName: parsed.name.text,
      fullName,
      // Packages §6: the project's own modules lie at the output root under
      // their declared names, its package segment elided — the layout's one
      // asymmetry, and the reason a project that gains a `name` moves no file.
      path: moduleLayoutPath(fullName, project.name),
      injected,
      seat: index,
    };
  };
  const moduleFiles = sourceFiles.filter(({ path }) => path.endsWith(".hex"));
  // A project with no modules injects nothing: its (empty) module list needs no
  // prelude, and the compile stays what a compilation of nothing was.
  if (moduleFiles.length === 0) return [];
  const supplied = moduleFiles.flatMap((source) =>
    parseFile(applyLayout(lex(source)), source.path).map((parsed) => ({ source, parsed }))
  );
  const adopted = new Set<Parsed.Module>();
  const units: Unit[] = [];
  for (const [index, member] of injectedModules.entries()) {
    const declared = member.basename.replace(/\.hex$/u, "");
    const own = supplied.find(({ source, parsed }) =>
      !adopted.has(parsed) &&
      source.path.slice(source.path.lastIndexOf("/") + 1) === member.basename &&
      parsed.name.text === declared
    );
    if (own !== undefined) {
      adopted.add(own.parsed);
      units.push(
        seat(own.source, own.parsed, STANDARD_LIBRARY, member.runtime ? "runtime" : "prelude", index),
      );
      continue;
    }
    const source = new Source.File(
      Source.fileId(nextFileId(sourceFiles, units)),
      `/${STANDARD_LIBRARY}/${member.basename}`,
      member.source,
    );
    const parsed = parseFile(applyLayout(lex(source)), source.path)[0]!;
    units.push(seat(source, parsed, STANDARD_LIBRARY, member.runtime ? "runtime" : "prelude", index));
  }
  for (const { source, parsed } of supplied) {
    if (adopted.has(parsed)) continue;
    units.push(seat(source, parsed, project.name, undefined, undefined));
  }
  return units;
}

function nextFileId(sourceFiles: readonly Source.File[], units: readonly Unit[]): number {
  return Math.max(
    -1,
    ...sourceFiles.map((file) => Number(file.id)),
    ...units.map((unit) => Number(unit.source.id)),
  ) + 1;
}

/**
 * The program's module index, with the two rules that read the *set* rather
 * than one import: duplicate names within a package (Modules §2.2) and the
 * first-segment rule at the header seat (§2.2, Packages §6).
 */
function moduleIndexOf(
  units: readonly Unit[],
  diagnostics: Diagnostics.Bag,
  project: ProgramPackage,
): ModuleIndex {
  // Packages §3.1: the project, `Hex`, and the `dependencies` closure. In this
  // slice the closure is the project's own list — a fact of the package set,
  // fixed before any import is resolved.
  const packageNames = new Set<string>([STANDARD_LIBRARY, ...project.dependencies]);
  if (project.name !== undefined) packageNames.add(project.name);
  const byFullName = new Map<string, ProgramModule>();
  /** First declaration of each name, per package, folded for the case rule. */
  const declared = new Map<string, Unit>();
  for (const unit of units) {
    const offending = firstSegmentPackage(unit.declaredName, packageNames);
    if (offending !== undefined) {
      diagnostics.add({
        severity: "error",
        message: `\`${unit.declaredName}\` begins with the name of the package ` +
          `\`${offending}\`; a dotted module's first segment cannot name a package ` +
          "in the program",
        primary: unit.parsed.name.span,
      });
      continue;
    }
    // Modules §2.2: two modules of one name in one package, compared
    // case-insensitively on the emitted filesystem's account (§11.1).
    // The separator is written as an escape, never as a literal NUL byte: a
    // source file carrying one is binary to every text tool a reader has.
    const key = `${unit.packageName ?? ""}\u0000${unit.declaredName.toLowerCase()}`;
    const first = declared.get(key);
    if (first !== undefined) {
      diagnostics.add({
        severity: "error",
        message: `module \`${unit.declaredName}\` is declared twice: ` +
          `\`${first.source.path}\` (line ${first.parsed.name.span.start.line + 1}) and ` +
          `\`${unit.source.path}\` (line ${unit.parsed.name.span.start.line + 1})`,
        primary: unit.parsed.name.span,
        fixes: [],
        notes: [`give one a dotted name, \`module Render.${unit.declaredName}\``],
      });
      continue;
    }
    declared.set(key, unit);
    byFullName.set(unit.fullName, {
      packageName: unit.packageName,
      declaredName: unit.declaredName,
      fullName: unit.fullName,
    });
  }
  return { byFullName, packages: [project] };
}

/**
 * Modules §10's rows for a written name that resolved to nothing.
 *
 * Exported for its tests alone. Two of its arms — `Contested` and
 * `NotADependency` — cannot be reached from `compileProject` while the package
 * set is `{project, Hex}`: a contest needs two packages providing one declared
 * name, and §3.2's occlusion answers before any two the project can assemble,
 * while a not-a-dependency report needs an installed set to check a name
 * against. They ship with byte-exact §10 wording, so the wording is executed
 * here until a real dependency package makes both reachable end to end.
 */
export function unresolvedModuleMessage(
  written: string,
  resolution: Exclude<ModuleResolution, { kind: "Resolved" }>,
): string {
  switch (resolution.kind) {
    case "Contested": {
      // A package name is code, quoted as every other name a report prints is
      // (Packages §3.3's own row: "`Acme` and `Hex`"); "this project" is prose,
      // the one participant with no name to print (Packages §2.5).
      const packages = resolution.providers.map(({ packageName }) =>
        packageName === undefined ? "this project" : `\`${packageName}\``
      );
      const spellings = resolution.providers.map(({ fullName }) => `\`import ${fullName}\``);
      return `\`${written}\` is provided by ${joinWithAnd(packages)}; write ${
        joinWithOr(spellings)
      }`;
    }
    case "SelfQualified":
      return `no module \`${written}\`; a package's own modules are imported by their ` +
        `declared names: \`import ${resolution.declaredName}\``;
    case "NotADependency":
      return `\`${resolution.packageName}\` is not a dependency of this package; add ` +
        `\`"${resolution.packageName}"\` to \`dependencies\` in \`hexagon.json\``;
    case "Unknown":
      return `no module \`${written}\`` + (resolution.nearMisses.length === 0
        ? ""
        : `; did you mean ${
          joinWithOr(resolution.nearMisses.map((name) => `\`${name}\``))
        }?`);
  }
}

function joinWithAnd(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function joinWithOr(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/** Reserved id floor for prelude identities, above any realistic per-project count. */
const PRELUDE_ID_BASE = 1_000_000;

function nextId(ids: readonly number[], fallback: number): number {
  return ids.length === 0 ? fallback : Math.max(fallback, ...ids.map((id) => id + 1));
}

/** One member of the injected list, and which of the two kinds it is. */
interface InjectedModule {
  readonly basename: string;
  readonly source: string;
  readonly runtime: boolean;
}

/**
 * The prelude and runtime module sets as one ordered list, each runtime member
 * taking the seat its `precedes` names.
 *
 * A `precedes` naming no prelude member would silently put the module last,
 * which is the one placement its seat exists to forbid, so it lands at the end
 * only when that is what the list already says. There is no such member today
 * and the conformance test pins the resulting order.
 */
function weaveInjected(
  prelude: readonly { readonly basename: string; readonly source: string }[],
  runtime: readonly {
    readonly basename: string;
    readonly source: string;
    readonly precedes: string;
  }[],
): readonly InjectedModule[] {
  const woven: InjectedModule[] = [];
  for (const member of prelude) {
    for (const module of runtime) {
      if (module.precedes === member.basename) {
        woven.push({ basename: module.basename, source: module.source, runtime: true });
      }
    }
    woven.push({ basename: member.basename, source: member.source, runtime: false });
  }
  const seated = new Set(woven.map(({ basename }) => basename));
  for (const module of runtime) {
    if (seated.has(module.basename)) continue;
    woven.push({ basename: module.basename, source: module.source, runtime: true });
  }
  return woven;
}

/**
 * Where a module finds each runtime module: it *is* one of them, or the
 * specifier that reaches each from here.
 *
 * A project with no path for a runtime module is one with no sources at all,
 * and its (empty) module list needs no runtime; the basename is simply left out
 * and the emitter's same-directory default stands in, so neither side has to
 * hold an extra case.
 */
function runtimesFor(
  path: string,
  pathsByBasename: ReadonlyMap<string, string>,
): RuntimeLocations {
  return new Map(
    [...pathsByBasename].map(([basename, runtimePath]) => [
      basename,
      path === runtimePath
        ? "self" as const
        : { specifier: relativeSpecifier(path, runtimePath) },
    ]),
  );
}


/**
 * The path an **emitted** specifier names, from the module that wrote it.
 *
 * No Hexagon `import` carries a specifier since #829 — a module is named, not
 * pathed (Modules §3) — so this now serves the two places a specifier still
 * exists, and they read against **different trees**.
 *
 * The emitted module graph's specifiers are computed from the modules' names
 * (§11.2), so they are read against the *layout*: `resolveSpecifier(unit.path,
 * …)`. A **foreign** specifier is never computed and never re-based (FFI Part
 * 4 §2.1, #839): it is JavaScript's own, emitted verbatim, and resolves at
 * load from the emitted file's own place — `extern from "./world.js"` in
 * `module Deep.Nested` names `Deep/world.js`, a file Hexagon neither writes
 * nor places. The compiler reads one of these exactly once, for the refusal
 * that catches a specifier naming a Hexagon source, and takes that reading
 * against the *source* tree from the importing file's own directory
 * (`resolveSpecifier(unit.source.path, …)`) — which is the tree the author
 * wrote it in. Nothing else reads it.
 */
export function resolveSpecifier(importer: string, specifier: string): string {
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const candidate = normalizePath(`${directory}/${specifier}`);
  return candidate.endsWith(".hex") ? candidate : `${candidate}.hex`;
}

/**
 * The specifier one module would write to import another — `resolveSpecifier`
 * read backwards, and the round trip is the property that matters:
 * `resolveSpecifier(importer, specifierFor(importer, target))` is `target`.
 *
 * Exported for the same reason its inverse is, and needed by the tooling tier
 * that *writes* an import line rather than reading one (Modules §5.1's LSP
 * obligation, #577). Same-directory targets keep the explicit `./`, which is
 * the only spelling the grammar admits for a relative path (§12.1: a bare
 * specifier is a package import, and those are refused), and an ascent is
 * spelled with as many `../` as the paths differ by.
 */
export function specifierFor(importer: string, target: string): string {
  const from = normalizePath(importer).split("/").slice(0, -1);
  const to = normalizePath(target).replace(/\.hex$/u, "").split("/");
  const file = to.pop()!;
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  const ascent = from.slice(shared).map(() => "..");
  const descent = to.slice(shared);
  const parts = [...ascent, ...descent, file];
  return ascent.length === 0 ? `./${parts.join("/")}` : parts.join("/");
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}
