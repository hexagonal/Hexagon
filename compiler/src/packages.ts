/**
 * Packages, and the resolution of a written module name in one (`spec/packages.md`).
 *
 * A package is a named set of modules (§1); the project is the root package and
 * may have no name (§2.5); the standard library is `Hex` (§2.4). This file holds
 * the parts of that design the *language* needs — full names, the visible set,
 * and what `import Geometry` means — and none of the parts the *host* owns:
 * nothing here reads a manifest, a `node_modules` directory, or a file. The
 * package set arrives assembled (Packages §4.1) and this module answers over it.
 *
 * That split is what keeps `project.ts` filesystem-free, and it is what let the
 * host layer arrive additively: a real dependency closure changed the *input* to
 * these functions and none of their rules. `validatePackageSet` below is the
 * other half of the same split — §4.1's and §4.3's rules read over records the
 * host's discovery answered with, with no path resolved and no directory read.
 */

import type * as Source from "./support/source.js";

/** The standard library's package name (Packages §2.4). */
export const STANDARD_LIBRARY = "Hex";

/**
 * A package in the program (Packages §3.1) — the project, `Hex`, or a member of
 * the transitive `dependencies` closure.
 *
 * `name` is absent for an **unnamed project** (§2.5), the one package whose
 * modules' full names carry no package segment.
 */
export interface ProgramPackage {
  readonly name: string | undefined;
  /** The packages this one's imports may name, by name (Packages §3.1). */
  readonly dependencies: readonly string[];
  /**
   * The package names **this package's own lookup answers with** (Packages
   * §4.1's sense of *installed*) — a superset of `dependencies`, and the set
   * Modules §2.3's not-a-dependency report reads.
   *
   * It travels on the package rather than arriving beside the resolution
   * because the question is per-package: `Acme` resolving `Bolt.Util` asks what
   * *`Acme`'s* directory can reach, which is not what the project's can. The
   * set enters no closure and draws no refusal of its own — a lookup run to
   * decide this report "adds nothing to the package set and draws no refusal"
   * (§4.1).
   */
  readonly installed: ReadonlySet<string>;
  /**
   * Where this package's `hexagon.json` is, for the reports that must send a
   * reader to it — the whole-program first-segment seat names the other
   * package, and the other package's only text is its manifest.
   *
   * Absent for a package whose manifest the host did not hand in as a source
   * file, and for `Hex`, which has none. A report then carries no label; it
   * never invents a location.
   */
  readonly manifest?: Source.Span;
}

/**
 * A package as a **record** (Packages §4.1): what a host's discovery answers
 * with, and the only thing the compiler validates a package set over.
 *
 * `directory` is the package's **canonical** directory, host-supplied and
 * opaque to the compiler: nothing here reads it as a path, and the only
 * arithmetic done on it is the relative printing §4.3's reports prescribe. Two
 * records with one `directory` are one package, which is how "two links reaching
 * one package are one copy" holds without this file knowing what a link is.
 */
export interface PackageRecord {
  readonly name: string | undefined;
  readonly dependencies: readonly string[];
  /** The canonical directory — the package's identity (Packages §4.3). */
  readonly directory: string;
  /** The npm manifest's version, where it declares one (§4.3's reports). */
  readonly version?: string;
  /** See `ProgramPackage.installed`; empty where the host computed none. */
  readonly installed?: ReadonlySet<string>;
  /** See `ProgramPackage.manifest`. */
  readonly manifest?: Source.Span;
  /**
   * Whether any `.hex` file sits beneath this package's manifest, within §2.2's
   * bounds — the one fact §7's stage-one row reads.
   *
   * A host answers it, because it is a fact about files and this file reads
   * none. Absent means "not answered", and the row is then not drawn: a harness
   * building records by hand is making a package set, not describing a
   * distribution, and inventing a refusal from a missing field would refuse
   * every one of them.
   */
  readonly hasSource?: boolean;
}

/** A manifest a lookup scanned and could not read or found unlawful (§4.1). */
export interface UnreadableManifest {
  /** The manifest's path, as the host spells it for the reader. */
  readonly path: string;
  readonly reason: string;
}

/**
 * One `dependencies` entry, as the host's lookup answered it (Packages §4.1).
 *
 * `candidates` is what the **nearest answering level** held — none, one, or the
 * two that draw §4.3's installed-twice report. A farther level's copy is
 * shadowed for this walk and is not here; it enters the program only where some
 * other package's lookup answers with it, as its own edge.
 */
export interface ResolvedEdge {
  /** The canonical directory of the package whose manifest carries the entry. */
  readonly from: string;
  /** The entry, as written. */
  readonly name: string;
  readonly candidates: readonly PackageRecord[];
  readonly unreadable: readonly UnreadableManifest[];
}

/**
 * A problem with the package set, seated at the manifest that carries the entry
 * that drew it (D3): a dependency's own unresolvable entry reports against the
 * dependency's `hexagon.json`, not against the project's.
 */
export interface PackageProblem {
  readonly message: string;
  /** The canonical directory of the manifest carrying the entry. */
  readonly directory: string;
  /** Which key of that manifest the report is about. */
  readonly key: "name" | "dependencies";
  /** The `dependencies` entry, where one entry drew it. */
  readonly entry?: string;
}

/** A module of some package in the program, addressed by its declared name. */
export interface ProgramModule {
  /** The declaring package's name, absent for an unnamed project's module. */
  readonly packageName: string | undefined;
  /** The name the header declared — `Option`, `Render.Geometry` (Modules §2.1). */
  readonly declaredName: string;
  /** The package's name, a dot, and the declared name (Packages §2.3). */
  readonly fullName: string;
  /**
   * The module's **layout address** (Packages §6) — `moduleLayoutPath` of the
   * full name under the resolving project's name, carried rather than
   * recomputed.
   *
   * One module has one address, and it is computed once, where the module is
   * seated. Two call sites each laying the name out again is how the project
   * segment came to be elided at the seat and kept at the import edge: a named
   * project's unit sat at `/Geometry.hex` while every edge pointed at
   * `/Acme/Geometry.hex`, so no import in a named project resolved and the
   * emitted specifier was `".js"`. Reading the address off the module the
   * resolution answered with is what makes that disagreement unspellable.
   */
  readonly path: string;
}

/**
 * A module's **full name** (Packages §2.3): the package's name, a dot, and the
 * declared name. A module of a project with no `name` has its declared name as
 * its full name — the one case with no package segment.
 */
export function fullModuleName(
  packageName: string | undefined,
  declaredName: string,
): string {
  return packageName === undefined ? declaredName : `${packageName}.${declaredName}`;
}

/**
 * The **canonical layout path** of a module — its full name as a path (Packages
 * §6): the project's modules at the output root by their declared names, dotted
 * segments as directories, every other package's under a directory named by the
 * package.
 *
 * This is the compiler's internal address for a module, and deliberately so.
 * Modules §11's emitted layout *is* the full name as a path, so the specifier
 * arithmetic every emission already does — `relativeSpecifier` from one module
 * to another — computes exactly the specifier §11.2 demands, with no second
 * rule beside it. Nothing reads a **source** path to answer a question about a
 * module; a source file's own name and place appear nowhere in the output.
 *
 * `projectName` is the **resolving project's** name, where it declared one, and
 * its package segment is elided from the layout — "*with the project's package
 * segment elided because a project may have none*" (§6). The full name (§2.3)
 * is untouched by that: `Acme.Main` is still the module's identity and still
 * its brand, and only the address it emits under drops the segment, so a
 * project that gains a `name` moves no file and changes no specifier.
 */
export function moduleLayoutPath(fullName: string, projectName?: string): string {
  const laid = projectName !== undefined && fullName.startsWith(`${projectName}.`)
    ? fullName.slice(projectName.length + 1)
    : fullName;
  return `/${laid.replaceAll(".", "/")}.hex`;
}

/** The full name a layout path spells, `moduleLayoutPath` read backwards. */
export function moduleNameOfLayoutPath(path: string): string {
  return path.replace(/^\//u, "").replace(/\.hex$/u, "").replaceAll("/", ".");
}

/**
 * A module's name **as a reader in `requesting` knows it** — the spelling that
 * package's source has to write to reach it.
 *
 * This is `resolveModuleName` read backwards, and it has to be: a line a report
 * offers is a line the reader will paste, so it must resolve where it lands.
 * §3.2 answers a package's **own** module from its declared name and §3.3
 * refuses the package's own name as a qualifier outright — "a package's own
 * modules are imported by their declared names" — so the requesting package's
 * segment is elided, and every other package's is kept: `Lib` inside `Acme`,
 * `Bolt.Lib` for a dependency's. The standard library is elided by the same
 * rule from the other side: it is always someone else's package, and Modules
 * §7.6 names a prelude home "by its bare name as the reader knows it (`Ord`,
 * not `Hex.Ord`)" because the prelude is in scope under exactly that spelling
 * (Packages §2.4).
 *
 * `requesting` is the **resolving package's** name, where it declared one, as
 * `moduleLayoutPath` takes the project's. Omitted — a pass-level harness with
 * no project around it — only the `Hex.` rule applies, which is the unnamed
 * project's answer and the one every caller had before the parameter existed.
 */
export function displayModuleName(fullName: string, requesting?: string): string {
  for (const own of [requesting, STANDARD_LIBRARY]) {
    if (own !== undefined && fullName.startsWith(`${own}.`)) {
      return fullName.slice(own.length + 1);
    }
  }
  return fullName;
}

/**
 * The `import` line that binds `fullName` under the alias `alias`, as a module
 * of `requesting` must write it (see `displayModuleName`).
 */
export function moduleImportLine(
  fullName: string,
  alias?: string,
  requesting?: string,
): string {
  const name = displayModuleName(fullName, requesting);
  return alias === undefined || alias === name.split(".").at(-1)
    ? `import ${name}`
    : `import ${name} as ${alias}`;
}

/**
 * How `import <written>` would resolve for a module, as Modules §5.1 rule 1's
 * repair clause asks it (#829's Ruling A).
 *
 * A narrowing of `ModuleResolution` to the two answers a *refusal* can act on:
 * the import that would work, or the full spellings a contest leaves the reader
 * to choose between. Every other outcome is "nothing to repair", which the
 * report says by leaving its repair clause off.
 */
export type ImportRepair =
  | { readonly kind: "Resolved"; readonly fullName: string }
  | { readonly kind: "Contested"; readonly fullNames: readonly string[] };

/** How a written module name failed to resolve (Packages §3.3, §7). */
export type ModuleResolution =
  | { readonly kind: "Resolved"; readonly module: ProgramModule }
  | {
    /** Two or more visible packages provide the written name (Packages §3.3). */
    readonly kind: "Contested";
    readonly providers: readonly ProgramModule[];
  }
  | {
    /** A package qualifying its own module (Packages §3.3, §2.5). */
    readonly kind: "SelfQualified";
    readonly declaredName: string;
  }
  | {
    /**
     * The first segment names an **installed** package the resolving one does
     * not list (Packages §7) — installed in §4.1's sense, one this package's
     * own lookup answers with (`ProgramPackage.installed`).
     */
    readonly kind: "NotADependency";
    readonly packageName: string;
  }
  | { readonly kind: "Unknown"; readonly nearMisses: readonly string[] };

/** The modules of the program, as resolution reads them. */
export interface ModuleIndex {
  /** Every module of every package in the program, by full name. */
  readonly byFullName: ReadonlyMap<string, ProgramModule>;
}

/**
 * Which packages a module of `resolving` may name (Packages §3.1): its own,
 * `Hex`, and every package its manifest lists. Nothing else — a dependency's
 * own dependencies are invisible even though their modules may be in the
 * program.
 */
export function visiblePackages(resolving: ProgramPackage): readonly (string | undefined)[] {
  return [resolving.name, STANDARD_LIBRARY, ...resolving.dependencies].filter(
    (name, index, all) => all.indexOf(name) === index,
  );
}

/**
 * The same packages in the order §3.3 **prints** a contest in: "the resolving
 * package's `dependencies` order, then `Hex`".
 *
 * A separate function from `visiblePackages` because the two answer different
 * questions. Membership is a set and its order is nobody's business; a contest
 * report is a sentence, and §7's first row fixes the order of the names in it —
 * "`Geometry` is provided by `Acme` and `Hex`", never the other way round. The
 * resolving package's own name is not here: §3.2 answered its own module before
 * any contest could be gathered, so it never contests.
 */
function contestOrder(resolving: ProgramPackage): readonly (string | undefined)[] {
  return [...resolving.dependencies, STANDARD_LIBRARY].filter(
    (name, index, all) => all.indexOf(name) === index,
  );
}

/**
 * Resolves one written module name for a module of `resolving` (Packages §3.4;
 * Modules §2.3).
 *
 * The order is the spec's, and each step is a refusal or an answer, never a
 * rank: the resolving package's own module wins silently (§3.2); a dotted
 * spelling whose first segment names a *visible other* package is that
 * package's module by its full name, the one reading of the spelling (§3.3);
 * otherwise exactly one visible package must provide the declared name, two
 * being the contest refusal and none the unknown-module report.
 */
export function resolveModuleName(
  written: string,
  resolving: ProgramPackage,
  index: ModuleIndex,
): ModuleResolution {
  const visible = visiblePackages(resolving);
  /**
   * The module `package` declares under the *declared* name `name`.
   *
   * The declaring package is checked as well as the key, because a full name is
   * not a unique reading of a (package, declared name) pair while a project may
   * have none (§2.5): an unnamed project's `module Bolt.Util` and the package
   * `Bolt`'s `module Util` are both `Bolt.Util`. Reading the key alone made the
   * project *provide* a dependency's module — `import Bolt.Util` resolved
   * silently to `Bolt`'s, in a project that lists no `Bolt`, instead of drawing
   * §7's not-a-dependency report. Modules §2.2's first-segment rule forbids the
   * declaration whenever `Bolt` is in the program, so the two never coexist —
   * but the resolution must not depend on another rule having fired first.
   */
  const declaredIn = (
    packageName: string | undefined,
    name: string,
  ): ProgramModule | undefined => {
    const module = index.byFullName.get(fullModuleName(packageName, name));
    return module?.packageName === packageName ? module : undefined;
  };
  // §3.2: the resolving package's own module wins, silently.
  const own = declaredIn(resolving.name, written);
  if (own !== undefined) return { kind: "Resolved", module: own };

  const segments = written.split(".");
  if (segments.length > 1) {
    const head = segments[0]!;
    // §3.3: a package never qualifies its own modules.
    if (head === resolving.name) {
      return { kind: "SelfQualified", declaredName: segments.slice(1).join(".") };
    }
    if (visible.includes(head)) {
      const qualified = declaredIn(head, segments.slice(1).join("."));
      if (qualified !== undefined) return { kind: "Resolved", module: qualified };
    }
  }
  // Otherwise the spelling is a *declared* name, sought in every visible package
  // — in §3.3's printing order, since two answers here are the contest refusal
  // and the order it names them in is the spec's.
  const providers = contestOrder(resolving).flatMap((packageName) => {
    const module = declaredIn(packageName, written);
    return module === undefined ? [] : [module];
  });
  if (providers.length === 1) return { kind: "Resolved", module: providers[0]! };
  if (providers.length > 1) return { kind: "Contested", providers };
  if (segments.length > 1) {
    const head = segments[0]!;
    // §3.3's proviso: the manifest edit is withheld where a module of any
    // package in the program — imported or not — is declared under that
    // segment, because applying it would refuse that module (Modules §2.2).
    //
    // **Dotted** declared names only. Modules §2.2's first-segment rule is about
    // a dotted name's first segment and says of the other case, plainly, that
    // "an undotted module is untouched: `module Json` beside a dependency
    // `Json` is the companion idiom's plainest spelling". So `module Zed`
    // beside an installed `Zed` refuses nothing once the entry is added, and
    // withholding the edit there would withhold it from the commonest layout
    // there is — a package and its consumer's companion module of the same
    // name.
    const shadowed = [...index.byFullName.values()].some(
      ({ declaredName }) => declaredName.includes(".") && declaredName.split(".")[0] === head,
    );
    if (resolving.installed.has(head) && !visible.includes(head) && !shadowed) {
      return { kind: "NotADependency", packageName: head };
    }
  }
  return { kind: "Unknown", nearMisses: nearMisses(written, resolving, index) };
}

/**
 * The near misses an unknown module name draws (Modules §2.3, §10): the visible
 * modules whose declared name **ends in** the written one included, "since that
 * is the miss this rule invites".
 */
function nearMisses(
  written: string,
  resolving: ProgramPackage,
  index: ModuleIndex,
): readonly string[] {
  const visible = new Set(visiblePackages(resolving));
  const candidates = [...index.byFullName.values()].filter(({ packageName }) =>
    visible.has(packageName)
  );
  const suffix = candidates
    .filter(({ declaredName }) => declaredName.endsWith(`.${written}`))
    .map(({ declaredName }) => declaredName);
  if (suffix.length > 0) return suffix;
  const lowered = written.toLowerCase();
  return candidates
    .filter(({ declaredName }) =>
      declaredName !== written && declaredName.toLowerCase() === lowered
    )
    .map(({ declaredName }) => declaredName);
}

/**
 * Modules §2.2's **first-segment rule**, at the header seat: a dotted module's
 * first segment never names a package in the program.
 *
 * Read as a function of the package **set**, which is what makes the two seats
 * one rule and the host layer additive: widening the set from `{project, Hex}`
 * to a dependency closure widens what this refuses and changes nothing else.
 * Answers the offending package name, or `undefined` where the name is lawful.
 */
export function firstSegmentPackage(
  declaredName: string,
  packageNames: ReadonlySet<string>,
): string | undefined {
  const segments = declaredName.split(".");
  if (segments.length < 2) return undefined;
  return packageNames.has(segments[0]!) ? segments[0]! : undefined;
}

/** Packages §2.1: one uppercase-start identifier, and no dots. */
const PACKAGE_NAME = /^[A-Z][A-Za-z0-9_]*$/u;

/**
 * Packages §2.1's shape refusal, with §7's dotted clause where the spelling is
 * dotted: dots are the *module* name's, and a reader who wrote `"Acme.Tools"`
 * meant a namespace, so the sentence names the form that has one rather than
 * leaving them to read the shape rule twice.
 */
function packageNameShapeRefusal(name: string): string {
  return "a package name is one uppercase-start identifier: write `\"Acme\"`" +
    (name.includes(".") ? " — a module's name is where dots belong" : "");
}

/**
 * Packages §2.1's manifest `name` rule: one uppercase-start identifier, not
 * dotted, and never `Hex`. Answers the refusal, or `undefined` where lawful.
 */
export function packageNameRefusal(name: string): string | undefined {
  if (name === STANDARD_LIBRARY) return "`Hex` is the standard library's package name";
  if (!PACKAGE_NAME.test(name)) return packageNameShapeRefusal(name);
  return undefined;
}

/**
 * Packages §2.4: `Hex` is every package's dependency and is never listed; §4.4:
 * an entry's **spelling** establishes whether it is a package name, and nothing
 * about what any package holds.
 *
 * Three refusals, told apart by the shape of the entry alone. `"Hex"` is read
 * first, ahead of the rest. An uppercase-start spelling that is not one
 * identifier is a package name written wrong (§2.1) — `"Acme.Tools"` is the
 * module-name form in a package-name seat. Anything else is no package name at
 * all, and the message says what the field expects and where a JavaScript
 * dependency goes instead — **without a verdict on the package**, because
 * `"@acme/geometry"` may well be a distribution whose `hexagon.json` declares
 * `"name": "Acme"`. Where upper-casing the first letter yields a lawful name
 * other than `Hex`, that spelling is named too, a miscased name being the
 * likelier mistake there; an entry `"hex"` gets no such hint, since the
 * spelling it would offer is the one §2.4 refuses.
 */
export function dependencyRefusal(name: string): string | undefined {
  if (name === STANDARD_LIBRARY) return "`Hex` is every package's dependency; remove the entry";
  if (PACKAGE_NAME.test(name)) return undefined;
  if (/^[A-Z]/u.test(name)) return packageNameShapeRefusal(name);
  const capitalised = name.charAt(0).toUpperCase() + name.slice(1);
  const perhaps = PACKAGE_NAME.test(capitalised) && capitalised !== STANDARD_LIBRARY
    ? `, perhaps \`"${capitalised}"\``
    : "";
  return `\`"${name}"\` is not a package name; \`dependencies\` expects a Hexagon ` +
    `package name, as the dependency's \`hexagon.json\` declares it${perhaps} — for a ` +
    `JavaScript dependency, declare it in \`package.json\` and bind it with ` +
    `\`extern from "${name}"\``;
}

/** Where a module's text is, for the reports that must send a reader to it. */
export interface ModuleSite {
  readonly path: string;
  readonly span: Source.Span;
}

// ---------------------------------------------------------------------------
// The package set: validation over records (Packages §4.1, §4.3)
// ---------------------------------------------------------------------------

/**
 * One package of the validated set, with the directory it came from.
 *
 * The directory travels back out because a host has to pair the answer with the
 * files it read: it discovers the closure to run each package's lookup from its
 * own place (§4.1), and this is validation's reading of the same closure. The
 * compiler itself reads the directory for nothing but §4.3's relative printing.
 */
export interface PackageSetMember {
  /** The canonical directory — the package's identity (§4.3). */
  readonly directory: string;
  readonly package: ProgramPackage;
}

/** What `validatePackageSet` answers: the closure, and what is wrong with it. */
export interface PackageSet {
  /**
   * The closure, in a deterministic order: the project first, then its
   * dependencies depth-first in manifest order. `Hex` is not among them — it is
   * the compiler's own, injected wherever a program is compiled (§2.4).
   */
  readonly packages: readonly PackageSetMember[];
  readonly problems: readonly PackageProblem[];
}

/**
 * Validates a resolved dependency graph — **pure**, over records, with no
 * filesystem anywhere near it (Packages §4.1's split: what a package *is* is
 * the language's, how its directory is *found* is a host's).
 *
 * The host runs each package's lookup from that package's own canonical
 * directory and hands the answers in as edges; this assembles the closure
 * outward from the project and reads §4.3's rules over it and nothing wider. A
 * copy nothing in the closure reaches is therefore refused by nothing, which is
 * §8's rejected index in one sentence.
 */
export function validatePackageSet(
  project: PackageRecord,
  edges: readonly ResolvedEdge[],
): PackageSet {
  const problems: PackageProblem[] = [];
  const edgesFrom = new Map<string, ResolvedEdge[]>();
  for (const edge of edges) {
    const seated = edgesFrom.get(edge.from);
    if (seated === undefined) edgesFrom.set(edge.from, [edge]);
    else seated.push(edge);
  }
  /** The closure by canonical directory, in the order it was assembled. */
  const closure = new Map<string, PackageRecord>([[project.directory, project]]);
  /** Which entry first reached each directory, for seating a duplicate's report. */
  const reachedBy = new Map<string, { from: string; name: string }>();
  /** Resolved edges of the closure, by directory — the graph the cycle rule reads. */
  const graph = new Map<string, string[]>();

  const walk = (record: PackageRecord): void => {
    const own: string[] = [];
    graph.set(record.directory, own);
    for (const name of record.dependencies) {
      const edge = (edgesFrom.get(record.directory) ?? []).find((candidate) =>
        candidate.name === name
      );
      // An entry the host ran no lookup for — a spelling §4.4 refused before
      // the walk — contributes no edge and no report of this file's.
      if (edge === undefined) continue;
      if (edge.candidates.length === 0) {
        problems.push({
          message: unresolvableNameMessage(name, edge.unreadable, project.directory),
          directory: record.directory,
          key: "dependencies",
          entry: name,
        });
        continue;
      }
      if (edge.candidates.length > 1) {
        // Two package roots at one level, both declaring the requested name, at
        // two canonical directories: no nearest-first rule orders them (§4.1).
        problems.push({
          message: installedTwiceMessage(name, edge.candidates, project.directory),
          directory: record.directory,
          key: "dependencies",
          entry: name,
        });
        continue;
      }
      const answered = edge.candidates[0]!;
      own.push(answered.directory);
      // An entry resolving to a directory already in the set adds an edge and
      // no package — the diamond, and the workspace link to the project itself
      // (§4.3's choice 7: no special case anywhere in the code).
      if (closure.has(answered.directory)) continue;
      closure.set(answered.directory, answered);
      reachedBy.set(answered.directory, { from: record.directory, name });
      // §7's stage-one row, at the entry that reached the package: a package
      // installed under a Hexagon manifest that ships none of its `.hex` is
      // §5.2's second stage arriving early, and the ordinary cause — a
      // `package.json` `files` list that forgot the source — leaves the reader
      // with "no module `Acme.Tools`" and no idea why. Seated like every other
      // row here, at the manifest carrying the entry.
      if (answered.hasSource === false) {
        problems.push({
          message: `\`${name}\` ships no Hexagon source; a Hexagon package is ` +
            "installed as source until compiled distribution exists",
          directory: record.directory,
          key: "dependencies",
          entry: name,
        });
      }
      walk(answered);
    }
  };
  walk(project);

  // §4.3's project-name refusal, read ahead of the general one-copy rule: the
  // project is the package with no directory to move, so its report is the one
  // that names the manifest a reader can act on.
  const named = [...closure.values()];
  const projectNameClash = project.name === undefined ? undefined : named.find((record) =>
    record.directory !== project.directory && record.name === project.name
  );
  if (projectNameClash !== undefined) {
    problems.push({
      message: `this project declares \`"name": "${project.name}"\`, and \`${project.name}\` ` +
        `is also installed at \`${relativeDirectory(project.directory, projectNameClash.directory)}\`; ` +
        "a program holds one package of each name",
      directory: project.directory,
      key: "name",
    });
  }

  // §4.3's one-copy rule, over the package set and nothing wider.
  const byName = new Map<string, PackageRecord[]>();
  for (const record of named) {
    if (record.name === undefined || record.name === project.name) continue;
    const seated = byName.get(record.name);
    if (seated === undefined) byName.set(record.name, [record]);
    else seated.push(record);
  }
  for (const [name, copies] of byName) {
    if (copies.length < 2) continue;
    // Seated at the entry that brought the *second* copy: the manifest carrying
    // the entry is the one whose reader can drop or move it.
    const seat = reachedBy.get(copies[1]!.directory);
    problems.push({
      message: installedTwiceMessage(name, copies, project.directory),
      directory: seat?.from ?? project.directory,
      key: "dependencies",
      ...(seat === undefined ? {} : { entry: seat.name }),
    });
  }

  for (const cycle of cyclesOf(project.directory, graph, closure)) {
    // The entry that closes the cycle is the one a reader removes.
    const closing = cycle.at(-2)!;
    const closes = closure.get(cycle.at(-1)!)!;
    problems.push({
      message: `dependency cycle: ${
        cycle.map((directory) => `\`${closure.get(directory)!.name}\``).join(" → ")
      }`,
      directory: closing,
      key: "dependencies",
      ...(closes.name === undefined ? {} : { entry: closes.name }),
    });
  }

  return {
    packages: named.map((record) => ({
      directory: record.directory,
      package: {
        name: record.name,
        dependencies: record.dependencies,
        installed: record.installed ?? new Set<string>(),
        ...(record.manifest === undefined ? {} : { manifest: record.manifest }),
      },
    })),
    problems,
  };
}

/**
 * §7's unresolvable-name row, with the tail naming every manifest this lookup
 * scanned and could not read (§4.1) — "named only inside the unresolvable-name
 * report of a lookup that scanned it", which is why the tail is built here and
 * nowhere else.
 */
function unresolvableNameMessage(
  name: string,
  unreadable: readonly UnreadableManifest[],
  projectDirectory: string,
): string {
  const base = `no installed package declares \`"name": "${name}"\`; install it, or ` +
    "check the name in its `hexagon.json`";
  if (unreadable.length === 0) return base;
  const tail = unreadable
    .map(({ path, reason }) =>
      `\`${relativeDirectory(projectDirectory, path)}\` could not be read: ${reason}`
    )
    .join("; ");
  return `${base} (${tail})`;
}

/** §4.3's installed-twice row: canonical directories, printed relative to the project. */
function installedTwiceMessage(
  name: string,
  copies: readonly PackageRecord[],
  projectDirectory: string,
): string {
  const printed = copies.map((record) => {
    const directory = `\`${relativeDirectory(projectDirectory, record.directory)}\``;
    return record.version === undefined ? directory : `${directory} (${record.version})`;
  });
  return `package \`${name}\` is installed twice: ${joinWithAnd(printed)}; ` +
    "a program holds one copy of each Hexagon package";
}

/**
 * Every cycle the closure's edges close, each reported once, found from the
 * project outward — so a cycle among packages the project reaches is rendered
 * from the package the walk entered it at (`Acme → Bolt → Acme`), and one the
 * project itself is part of from the project (`MyApp → Bolt → MyApp`).
 */
function cyclesOf(
  root: string,
  graph: ReadonlyMap<string, readonly string[]>,
  closure: ReadonlyMap<string, PackageRecord>,
): readonly (readonly string[])[] {
  const cycles: string[][] = [];
  const reported = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const done = new Set<string>();
  const visit = (directory: string): void => {
    if (onStack.has(directory)) {
      const cycle = [...stack.slice(stack.indexOf(directory)), directory];
      // Keyed by the cycle's members rather than by its rendering, so one cycle
      // met from two entries is reported once.
      const key = [...new Set(cycle)].sort().join(" ");
      if (!reported.has(key)) {
        reported.add(key);
        cycles.push(cycle);
      }
      return;
    }
    if (done.has(directory)) return;
    stack.push(directory);
    onStack.add(directory);
    for (const target of graph.get(directory) ?? []) {
      if (closure.has(target)) visit(target);
    }
    onStack.delete(directory);
    stack.pop();
    done.add(directory);
  };
  visit(root);
  return cycles;
}

/**
 * One canonical directory as a reader of the project sees it — relative to the
 * project, climbing where the walk climbed (`../node_modules/@acme/geometry`).
 *
 * String arithmetic over `/`-separated canonical paths, which is all a
 * filesystem-free compiler can do and all §4.3 asks for: "the report prints each
 * directory relative to the project". A path on another root — no shared prefix
 * at all — is printed as it stands, there being no relative spelling of it.
 */
export function relativeDirectory(from: string, to: string): string {
  const source = from.replaceAll("\\", "/").split("/").filter((part) => part !== "");
  const target = to.replaceAll("\\", "/").split("/").filter((part) => part !== "");
  let shared = 0;
  while (shared < source.length && shared < target.length && source[shared] === target[shared]) {
    shared += 1;
  }
  if (shared === 0) return to;
  const parts = [...source.slice(shared).map(() => ".."), ...target.slice(shared)];
  return parts.length === 0 ? "." : parts.join("/");
}

// ---------------------------------------------------------------------------
// Modules §2.2's first-segment rule, at the whole-program seat
// ---------------------------------------------------------------------------

/**
 * How the project reaches a package: which of its **own** `dependencies`
 * entries bring it, "however long the chain" (Modules §2.2).
 *
 * A report never names an intermediate package the project cannot act on, so
 * every repair is worded over these entries and this is what computes them.
 */
export function bringersOf(
  project: ProgramPackage,
  packages: readonly ProgramPackage[],
): ReadonlyMap<string, readonly string[]> {
  const byName = new Map<string, ProgramPackage>();
  for (const member of packages) {
    if (member.name !== undefined) byName.set(member.name, member);
  }
  const bringers = new Map<string, string[]>();
  for (const entry of project.dependencies) {
    const pending = [entry];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const name = pending.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      const reached = bringers.get(name);
      if (reached === undefined) bringers.set(name, [entry]);
      else if (!reached.includes(entry)) reached.push(entry);
      for (const next of byName.get(name)?.dependencies ?? []) pending.push(next);
    }
  }
  return bringers;
}

/** What a whole-program first-segment report needs to know about the program. */
export interface FirstSegmentContext {
  /** The project's own `dependencies` entries, in manifest order. */
  readonly directEntries: readonly string[];
  /** `bringersOf`'s answer. */
  readonly bringers: ReadonlyMap<string, readonly string[]>;
}

/**
 * Modules §2.2's **whole-program** first-segment report: a module whose dotted
 * name begins with a package the declaring package cannot see.
 *
 * Three variants, one device. Every package the report names that is not itself
 * an entry of the project's `dependencies` carries its bringers in a
 * parenthetical after the phrase that names it; every repair is worded over the
 * project's own entries; and where one entry brings both packages named, the two
 * repairs collapse and the "combine them" clause goes, since the project never
 * combined them and cannot separate them.
 */
export function wholeProgramFirstSegmentMessage(
  declaredName: string,
  declaringPackage: string | undefined,
  offending: string,
  offendingIsProject: boolean,
  context: FirstSegmentContext,
): string {
  const of = declaringPackage === undefined
    ? "of the project"
    : `of package \`${declaringPackage}\`${parenthetical(declaringPackage, context)}`;
  const head = `module \`${declaredName}\` ${of} begins with the name of `;
  if (offendingIsProject) {
    // The mirror case: the project being compiled cannot be dropped.
    return `${head}this project, \`${offending}\`; rename the project or drop its ` +
      `manifest \`name\`, ${dropClause(declaringPackage!, context)}, or combine them ` +
      `once \`${declaringPackage}\` renames its module`;
  }
  const names = `the package \`${offending}\`, also in this program${
    parenthetical(offending, context)
  }`;
  if (declaringPackage === undefined) {
    // The project's own module: renaming a package is not among its repairs.
    return `${head}${names}; rename the module, or ${dropClause(offending, context)}`;
  }
  // "Where **one entry** brings both packages named, the two repairs collapse
  // into one" (Modules §2.2) — one entry, and no other. The condition is that
  // both bringer sets are the same single entry, not that they overlap: where
  // `Acme` is brought by `Carbide` and `Chroma` and `Bolt` only by `Carbide`,
  // dropping `Carbide` leaves `Acme` in the program and the collapsed sentence
  // would be false. Every other overlap therefore renders each package's full
  // bringer list with the plural repair below.
  const bringsOffending = context.bringers.get(offending) ?? [];
  const bringsDeclaring = context.bringers.get(declaringPackage) ?? [];
  if (
    bringsOffending.length === 1 && bringsDeclaring.length === 1 &&
    bringsOffending[0] === bringsDeclaring[0]
  ) {
    return `${head}${names}; drop the dependency that brings both \`${offending}\` and \`${declaringPackage}\``;
  }
  const second = (context.bringers.get(declaringPackage) ?? []).length === 1
    ? `the one that brings \`${declaringPackage}\``
    : `the ones that bring \`${declaringPackage}\``;
  return `${head}${names}; ${dropClause(offending, context)} or ${second}, or combine them ` +
    `once \`${offending}\` is renamed or \`${declaringPackage}\` renames its module`;
}

/** "(brought in by `Carbide`)", "(a direct dependency, and brought in by `Carbide`)". */
function parenthetical(name: string, context: FirstSegmentContext): string {
  const bringers = context.bringers.get(name) ?? [];
  const direct = context.directEntries.includes(name);
  const others = bringers.filter((entry) => entry !== name);
  if (direct && others.length === 0) return "";
  if (direct) return ` (a direct dependency, and brought in by ${joinWithAnd(quoted(others))})`;
  if (bringers.length === 0) return "";
  return ` (brought in by ${joinWithAnd(quoted(bringers))})`;
}

/** "drop the dependency that brings `Acme`", plural where several bring it. */
function dropClause(name: string, context: FirstSegmentContext): string {
  const bringers = context.bringers.get(name) ?? [];
  return bringers.length > 1
    ? `drop the dependencies that bring \`${name}\``
    : `drop the dependency that brings \`${name}\``;
}

function quoted(names: readonly string[]): readonly string[] {
  return names.map((name) => `\`${name}\``);
}

function joinWithAnd(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
