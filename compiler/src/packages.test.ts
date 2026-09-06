import { describe, expect, test } from "vitest";

import {
  bringersOf,
  dependencyRefusal,
  displayModuleName,
  firstSegmentPackage,
  fullModuleName,
  moduleImportLine,
  moduleLayoutPath,
  moduleNameOfLayoutPath,
  type ModuleIndex,
  type ProgramModule,
  type ProgramPackage,
  packageNameRefusal,
  relativeDirectory,
  resolveModuleName,
  validatePackageSet,
  visiblePackages,
  wholeProgramFirstSegmentMessage,
  type FirstSegmentContext,
  type PackageProblem,
  type PackageRecord,
  type ResolvedEdge,
} from "./packages.js";

/**
 * Unit conformance for `spec/packages.md`'s resolution, naming, and package-set
 * rules.
 *
 * Every arm here is also reached end to end from `compileProject`
 * (`project.test.ts`'s §9 specimens); these are the narrow readings — one
 * resolution, one edge, one message — that a golden test would only sample.
 */

const HEX: ProgramPackage = { name: "Hex", dependencies: [], installed: new Set() };

/** A package as `compileProject` seats one, with its lookup's answers (§4.1). */
function package_(
  name: string | undefined,
  dependencies: readonly string[] = [],
  installed: readonly string[] = [],
): ProgramPackage {
  return { name, dependencies, installed: new Set(installed) };
}

function module_(packageName: string | undefined, declaredName: string): ProgramModule {
  const fullName = fullModuleName(packageName, declaredName);
  // The address the module was seated at (§6), carried on the module rather
  // than laid out again by each reader — `compileProject` reads it back off the
  // resolution to key the import edge.
  return { packageName, declaredName, fullName, path: moduleLayoutPath(fullName) };
}

function indexOf(...modules: readonly ProgramModule[]): ModuleIndex {
  return {
    byFullName: new Map(modules.map((module) => [module.fullName, module])),
  };
}

describe("§2.3 — a module's full name", () => {
  test("the package's name, a dot, and the declared name", () => {
    expect(fullModuleName("Acme", "Render.Geometry")).toBe("Acme.Render.Geometry");
  });

  test("an unnamed project's module carries no package segment", () => {
    expect(fullModuleName(undefined, "Main")).toBe("Main");
  });

  test("the standard library's segment is dropped where a reader is addressed (§7.6)", () => {
    expect(displayModuleName("Hex.Ord")).toBe("Ord");
    expect(displayModuleName("Acme.Ord")).toBe("Acme.Ord");
  });

  test("an import line drops an alias the default already spells", () => {
    expect(moduleImportLine("Hex.Option")).toBe("import Option");
    expect(moduleImportLine("Render.Geometry", "Geometry")).toBe("import Render.Geometry");
    expect(moduleImportLine("Acme.Metric", "Scale")).toBe("import Acme.Metric as Scale");
  });
});

describe("§6 — the layout a module emits under", () => {
  test("dotted segments are directories", () => {
    expect(moduleLayoutPath("Render.Geometry")).toBe("/Render/Geometry.hex");
  });

  test("another package's modules lie under a directory named by the package", () => {
    expect(moduleLayoutPath("Hex.Option", "MyApp")).toBe("/Hex/Option.hex");
    expect(moduleLayoutPath("Acme.Render.Geometry", "MyApp")).toBe("/Acme/Render/Geometry.hex");
  });

  /**
   * "*with the project's package segment elided because a project may have
   * none*" (§6). The full name keeps it; only the address drops it, so a
   * project that gains a `name` moves no file.
   */
  test("the resolving project's own segment is elided", () => {
    expect(moduleLayoutPath("MyApp.Main", "MyApp")).toBe("/Main.hex");
    expect(moduleLayoutPath("MyApp.Render.Geometry", "MyApp")).toBe("/Render/Geometry.hex");
  });

  test("elision is by whole segment, never by prefix", () => {
    // `MyApplication` begins with `MyApp` and is another package entirely.
    expect(moduleLayoutPath("MyApplication.Main", "MyApp")).toBe("/MyApplication/Main.hex");
  });

  test("a layout path reads back as the full name it was laid from", () => {
    expect(moduleNameOfLayoutPath("/Hex/Option.hex")).toBe("Hex.Option");
    expect(moduleNameOfLayoutPath(moduleLayoutPath("Acme.Render.Geometry"))).toBe(
      "Acme.Render.Geometry",
    );
  });
});

describe("§3.1 — which packages a module may name", () => {
  test("its own, `Hex`, and every listed dependency, each once", () => {
    expect(visiblePackages(package_("MyApp", ["Acme", "Bolt"]))).toEqual([
      "MyApp",
      "Hex",
      "Acme",
      "Bolt",
    ]);
  });

  test("an unnamed project is the `undefined` seat, and `Hex` is never doubled", () => {
    expect(visiblePackages(package_(undefined))).toEqual([undefined, "Hex"]);
    expect(visiblePackages(HEX)).toEqual(["Hex"]);
  });

  test("a dependency's own dependencies are invisible", () => {
    expect(visiblePackages(package_(undefined, ["Bolt"]))).not.toContain("Acme");
  });
});

describe("§3.4 — resolving one written module name", () => {
  const project: ProgramPackage = package_(undefined, ["Acme"]);

  test("the resolving package's own module wins, silently", () => {
    const own = module_(undefined, "Geometry");
    expect(resolveModuleName("Geometry", project, indexOf(own, module_("Acme", "Geometry"))))
      .toEqual({ kind: "Resolved", module: own });
  });

  test("a dotted spelling whose first segment names a visible package is that package's", () => {
    const theirs = module_("Acme", "Geometry");
    expect(resolveModuleName("Acme.Geometry", project, indexOf(theirs))).toEqual({
      kind: "Resolved",
      module: theirs,
    });
  });

  test("a declared name exactly one visible package provides resolves to it", () => {
    const theirs = module_("Acme", "Geometry");
    expect(resolveModuleName("Geometry", project, indexOf(theirs))).toEqual({
      kind: "Resolved",
      module: theirs,
    });
  });

  /**
   * §3.3 and §7's first row both fix the order: "the resolving package's
   * `dependencies` order, then `Hex`". The resolving package's own module never
   * contests — §3.2 answered it before this point.
   */
  test("a name two visible packages provide is contested, in `dependencies` order then `Hex`", () => {
    const resolution = resolveModuleName(
      "Geometry",
      project,
      indexOf(module_("Acme", "Geometry"), module_("Hex", "Geometry")),
    );
    expect(resolution.kind).toBe("Contested");
    expect(resolution.kind === "Contested" ? resolution.providers.map(({ fullName }) => fullName) : [])
      .toEqual(["Acme.Geometry", "Hex.Geometry"]);
  });

  test("a package qualifying its own module is refused, the declared name named", () => {
    expect(resolveModuleName(
      "MyApp.Geometry",
      package_("MyApp"),
      indexOf(module_("MyApp", "Geometry")),
    )).toEqual({ kind: "SelfQualified", declaredName: "Geometry" });
  });

  /** §7's row, read off this package's own `installed` set (§4.1's sense). */
  test("a first segment naming an installed package the resolver does not list", () => {
    expect(resolveModuleName(
      "Acme.Tools",
      package_(undefined, ["Bolt"], ["Bolt", "Acme"]),
      indexOf(module_("Bolt", "Widgets")),
    )).toEqual({ kind: "NotADependency", packageName: "Acme" });
  });

  test("the manifest edit is withheld where a module is declared under that segment", () => {
    // §3.3's proviso: applying it would refuse that module (Modules §2.2), so
    // the unknown-module report fires instead.
    expect(resolveModuleName(
      "Acme.Missing",
      package_(undefined, ["Bolt"], ["Bolt", "Acme"]),
      indexOf(module_("Bolt", "Acme.Tools")),
    ).kind).toBe("Unknown");
  });

  test("an unknown name names the dotted modules ending in it", () => {
    expect(resolveModuleName(
      "Geometry",
      project,
      indexOf(module_(undefined, "Render.Geometry"), module_("Acme", "Physics.Geometry")),
      // Named as an importer would write them: the declared name, the
      // package segment absent (§2.3).
    )).toEqual({ kind: "Unknown", nearMisses: ["Render.Geometry", "Physics.Geometry"] });
  });

  test("an invisible package's module is no near miss", () => {
    expect(resolveModuleName(
      "Geometry",
      package_(undefined),
      indexOf(module_("Bolt", "Render.Geometry")),
    )).toEqual({ kind: "Unknown", nearMisses: [] });
  });

  test("a case-only miss is named where no dotted suffix answers", () => {
    expect(resolveModuleName(
      "geometry",
      project,
      indexOf(module_("Acme", "Geometry")),
    )).toEqual({ kind: "Unknown", nearMisses: ["Geometry"] });
  });
});

describe("§2.2 — the first-segment rule, read off the package set", () => {
  test("a dotted name whose first segment names a package is refused", () => {
    expect(firstSegmentPackage("Acme.Tools", new Set(["Hex", "Acme"]))).toBe("Acme");
  });

  test("an undotted name of that spelling is lawful", () => {
    expect(firstSegmentPackage("Acme", new Set(["Hex", "Acme"]))).toBeUndefined();
  });

  test("only the first segment counts", () => {
    expect(firstSegmentPackage("Render.Acme", new Set(["Acme"]))).toBeUndefined();
  });
});

describe("§2.1 / §4.4 — the manifest's two name seats", () => {
  test("a lawful package name is one uppercase-start identifier", () => {
    expect(packageNameRefusal("Acme")).toBeUndefined();
    expect(packageNameRefusal("Acme_2")).toBeUndefined();
  });

  /**
   * §2.1 names Lexer §3.1's `UpperName`, which is Unicode-uppercase: `Ä`, `R`
   * and `Δ` all have `Uppercase = Yes`, and an ASCII test admits only the
   * middle one. The refusal would land on a manifest whose module headers the
   * lexer accepts — `module Ärger` is lawful, so `"name": "Ärger"` is.
   */
  test("a non-ASCII uppercase name is a package name (Lexer §3.1)", () => {
    expect(packageNameRefusal("Ärger")).toBeUndefined();
    expect(packageNameRefusal("Résultat")).toBeUndefined();
    expect(packageNameRefusal("Δelta")).toBeUndefined();
  });

  /**
   * §3.1's rule is `Uppercase = Yes` **or** `General_Category = Lt`, so the
   * titlecase digraph `ǅ` — which has `Uppercase = No` — starts an `UpperName`
   * too, and a `Uppercase`-only test would refuse a name the lexer accepts.
   */
  test("a titlecase start is a package name, as §3.1's `Lt` clause says", () => {
    expect(packageNameRefusal("ǅurđević")).toBeUndefined();
  });

  /**
   * U+1D400 is uppercase and astral. Judged by `name[0]` the first *code unit*
   * is a lone high surrogate, which has no Unicode property worth testing and
   * refuses the name; judged by the first codepoint, it is a name.
   */
  test("an astral uppercase start is a package name, not half a surrogate pair", () => {
    expect(packageNameRefusal("\u{1D400}bc")).toBeUndefined();
  });

  /** A caseless script has no uppercase start, and §3.1 makes `用户` a term name. */
  test("a caseless or lowercase non-ASCII name draws the shape rule", () => {
    expect(packageNameRefusal("用户")).toBe(
      "a package name is one uppercase-start identifier: write `\"Acme\"`",
    );
    expect(packageNameRefusal("résultat")).toBe(
      "a package name is one uppercase-start identifier: write `\"Acme\"`",
    );
  });

  test("`Hex` is the standard library's, and never a project's", () => {
    expect(packageNameRefusal("Hex")).toBe("`Hex` is the standard library's package name");
  });

  test("a lowercase name is refused with the shape rule", () => {
    expect(packageNameRefusal("acme")).toBe(
      "a package name is one uppercase-start identifier: write `\"Acme\"`",
    );
  });

  /**
   * §7's dotted clause: a reader who wrote `"Acme.Tools"` meant a namespace,
   * so the sentence names the form that has one rather than leaving them to
   * read the shape rule twice.
   */
  test("a dotted name is refused with the clause naming where dots belong", () => {
    expect(packageNameRefusal("Acme.Tools")).toBe(
      "a package name is one uppercase-start identifier: write `\"Acme\"`" +
        " — a module's name is where dots belong",
    );
  });

  test("`Hex` under `dependencies` is refused as every package's own", () => {
    expect(dependencyRefusal("Hex")).toBe(
      "`Hex` is every package's dependency; remove the entry",
    );
  });

  test("a lawful dependency entry draws nothing", () => {
    expect(dependencyRefusal("Acme")).toBeUndefined();
  });

  /**
   * §4.4's branches read §2.1's class, so the two seats are one rule: an entry
   * an ASCII test refuses is not merely refused, it is sent down the JavaScript
   * route — told to write `extern from "Ärger"` for a Hexagon package.
   */
  test("a non-ASCII uppercase entry is a package name, not npm's", () => {
    expect(dependencyRefusal("Ärger")).toBeUndefined();
    expect(dependencyRefusal("Résultat")).toBeUndefined();
    expect(dependencyRefusal("Δelta")).toBeUndefined();
    expect(dependencyRefusal("ǅurđević")).toBeUndefined();
    expect(dependencyRefusal("\u{1D400}bc")).toBeUndefined();
  });

  /**
   * §4.4's perhaps-clause upper-cases the first *codepoint*: `r` → `R` yields
   * `Résultat`, a lawful name. `charAt(0)` would be right here and wrong for an
   * astral entry, where it upper-cases half a surrogate pair.
   */
  test("a miscased non-ASCII entry names the spelling it could take", () => {
    expect(dependencyRefusal("résultat")).toBe(
      "`\"résultat\"` is not a package name; `dependencies` expects a Hexagon package " +
        "name, as the dependency's `hexagon.json` declares it, perhaps `\"Résultat\"` — " +
        "for a JavaScript dependency, declare it in `package.json` and bind it " +
        "with `extern from \"résultat\"`",
    );
  });

  /**
   * U+10428 DESERET SMALL LETTER LONG I upper-cases to U+10400, so the entry
   * has a spelling to be offered. `charAt(0).toUpperCase()` upper-cases a lone
   * high surrogate to itself and rebuilds the same string, and the hint that
   * §4.4 prescribes silently never appears.
   */
  test("a miscased astral entry names the spelling it could take", () => {
    expect(dependencyRefusal("\u{10428}bc")).toContain(
      "perhaps `\"\u{10400}bc\"`",
    );
  });

  /** No case mapping raises `用`, so the field's expectation is named and nothing more. */
  test("a caseless entry is refused with no spelling to offer", () => {
    const refusal = dependencyRefusal("用户");
    expect(refusal).not.toContain("perhaps");
    expect(refusal).toBe(
      "`\"用户\"` is not a package name; `dependencies` expects a Hexagon package " +
        "name, as the dependency's `hexagon.json` declares it — for a JavaScript " +
        "dependency, declare it in `package.json` and bind it with " +
        "`extern from \"用户\"`",
    );
  });

  /**
   * §4.4: the entry's spelling establishes whether it is a package name and
   * **nothing about what the package holds** — `@acme/geometry` may well carry a
   * `hexagon.json` declaring `"name": "Acme"`, so the message names the field's
   * expectation and the JavaScript route, never a verdict.
   */
  test("a spelling no package name can take is refused as no package name", () => {
    expect(dependencyRefusal("@acme/geometry")).toBe(
      "`\"@acme/geometry\"` is not a package name; `dependencies` expects a Hexagon " +
        "package name, as the dependency's `hexagon.json` declares it — for a " +
        "JavaScript dependency, declare it in `package.json` and bind it with " +
        "`extern from \"@acme/geometry\"`",
    );
    expect(dependencyRefusal("tiny-json")).toBe(
      "`\"tiny-json\"` is not a package name; `dependencies` expects a Hexagon " +
        "package name, as the dependency's `hexagon.json` declares it — for a " +
        "JavaScript dependency, declare it in `package.json` and bind it with " +
        "`extern from \"tiny-json\"`",
    );
  });

  test("a miscased name names the spelling it could take", () => {
    expect(dependencyRefusal("acme")).toBe(
      "`\"acme\"` is not a package name; `dependencies` expects a Hexagon package " +
        "name, as the dependency's `hexagon.json` declares it, perhaps `\"Acme\"` — " +
        "for a JavaScript dependency, declare it in `package.json` and bind it " +
        "with `extern from \"acme\"`",
    );
  });

  /** §2.4: the hint would offer a spelling the manifest refuses, so it is withheld. */
  test("`hex` gets no perhaps-clause, since `Hex` is refused", () => {
    expect(dependencyRefusal("hex")).not.toContain("perhaps");
  });

  /**
   * The two refusals are told apart by the entry's *shape*: an uppercase-start
   * spelling is a package name written wrong (§2.1), and sending its author to
   * `extern from "Acme.Tools"` would name a JavaScript module that cannot
   * exist.
   */
  test("a dotted uppercase entry is a malformed package name, not npm's", () => {
    expect(dependencyRefusal("Acme.Tools")).toBe(
      "a package name is one uppercase-start identifier: write `\"Acme\"`" +
        " — a module's name is where dots belong",
    );
  });

  /**
   * The shape branch reads §3.1's class too, not `[A-Z]`: `Ärger.Tools` and
   * `ǅ.Tools` are module names in a package-name seat and take §2.1's refusal,
   * where an ASCII test would send both down §4.4's JavaScript route and tell
   * their authors to write `extern from "Ärger.Tools"` for a Hexagon module.
   */
  test("a non-ASCII uppercase-start entry that is not one identifier draws the shape rule", () => {
    expect(dependencyRefusal("Ärger.Tools")).toBe(
      "a package name is one uppercase-start identifier: write `\"Acme\"`" +
        " — a module's name is where dots belong",
    );
    expect(dependencyRefusal("ǅ.Tools")).toBe(
      "a package name is one uppercase-start identifier: write `\"Acme\"`" +
        " — a module's name is where dots belong",
    );
  });
});

// ---------------------------------------------------------------------------
// §4.1 / §4.3 — the package set, validated over records
// ---------------------------------------------------------------------------

const PROJECT_DIRECTORY = "/work/app";

function record_(
  name: string | undefined,
  directory: string,
  dependencies: readonly string[] = [],
  version?: string,
): PackageRecord {
  return { name, directory, dependencies, ...(version === undefined ? {} : { version }) };
}

function edge_(
  from: string,
  name: string,
  candidates: readonly PackageRecord[],
  unreadable: readonly { path: string; reason: string }[] = [],
): ResolvedEdge {
  return { from, name, candidates, unreadable };
}

/** The project of §9 (e)'s specimens, whose directory every report is printed from. */
function project_(
  dependencies: readonly string[] = [],
  name?: string,
): PackageRecord {
  return record_(name, PROJECT_DIRECTORY, dependencies);
}

function messages(set: { problems: readonly PackageProblem[] }): readonly string[] {
  return set.problems.map(({ message }) => message);
}

describe("§4.1 — the closure, assembled outward from the project", () => {
  test("the project comes first, then its dependencies depth-first in manifest order", () => {
    const bolt = record_("Bolt", `${PROJECT_DIRECTORY}/node_modules/bolt`, ["Carbide"]);
    const carbide = record_("Carbide", `${PROJECT_DIRECTORY}/node_modules/carbide`);
    const acme = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme`);
    const set = validatePackageSet(project_(["Bolt", "Acme"]), [
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
      edge_(PROJECT_DIRECTORY, "Acme", [acme]),
      edge_(bolt.directory, "Carbide", [carbide]),
    ]);
    expect(set.problems).toEqual([]);
    expect(set.packages.map(({ package: member }) => member.name)).toEqual([
      undefined,
      "Bolt",
      "Carbide",
      "Acme",
    ]);
  });

  test("an entry resolving to a directory already in the set adds an edge and no package", () => {
    // The diamond: the project and `Bolt` both list `Acme`, and one lookup's
    // answer is the other's.
    const bolt = record_("Bolt", `${PROJECT_DIRECTORY}/node_modules/bolt`, ["Acme"]);
    const acme = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme`);
    const set = validatePackageSet(project_(["Bolt", "Acme"]), [
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
      edge_(PROJECT_DIRECTORY, "Acme", [acme]),
      edge_(bolt.directory, "Acme", [acme]),
    ]);
    expect(set.problems).toEqual([]);
    expect(set.packages).toHaveLength(3);
  });

  /**
   * §9 (e): `node_modules/acme` and `node_modules/@acme/geometry` are both links
   * to `packages/acme` — one copy, at its canonical directory (§4.3). The host
   * canonicalises; what this pins is that two edges answering one directory
   * assemble one package.
   */
  test("two links reaching one canonical directory are one copy", () => {
    const acme = record_("Acme", "/work/packages/acme");
    const bolt = record_("Bolt", `${PROJECT_DIRECTORY}/node_modules/bolt`, ["Acme"]);
    const set = validatePackageSet(project_(["Acme", "Bolt"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [acme]),
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
      edge_(bolt.directory, "Acme", [acme]),
    ]);
    expect(set.problems).toEqual([]);
    expect(set.packages.filter(({ package: member }) => member.name === "Acme")).toHaveLength(1);
  });

  test("a listed name no lookup answers with is refused, seated at its own manifest", () => {
    const set = validatePackageSet(project_(["Lodash"]), [
      edge_(PROJECT_DIRECTORY, "Lodash", []),
    ]);
    expect(messages(set)).toEqual([
      "no installed package declares `\"name\": \"Lodash\"`; install it, or check the " +
        "name in its `hexagon.json`",
    ]);
    expect(set.problems[0]).toMatchObject({
      directory: PROJECT_DIRECTORY,
      key: "dependencies",
      entry: "Lodash",
    });
  });

  /** D3: a dependency's own unresolvable entry reports against the dependency's manifest. */
  test("a dependency's own entry reports against the dependency's manifest", () => {
    const bolt = record_("Bolt", `${PROJECT_DIRECTORY}/node_modules/bolt`, ["Missing"]);
    const set = validatePackageSet(project_(["Bolt"]), [
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
      edge_(bolt.directory, "Missing", []),
    ]);
    expect(set.problems[0]).toMatchObject({ directory: bolt.directory, entry: "Missing" });
  });

  test("a manifest the walk could not read is named in the report of the lookup that scanned it", () => {
    const set = validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [], [{
        path: `${PROJECT_DIRECTORY}/node_modules/@acme/geometry/hexagon.json`,
        reason: "Unexpected token }",
      }]),
    ]);
    expect(messages(set)).toEqual([
      "no installed package declares `\"name\": \"Acme\"`; install it, or check the " +
        "name in its `hexagon.json` (`node_modules/@acme/geometry/hexagon.json` " +
        "could not be read: Unexpected token })",
    ]);
  });

  test("several unreadable manifests are joined in one parenthetical", () => {
    const set = validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [], [
        { path: `${PROJECT_DIRECTORY}/node_modules/a/hexagon.json`, reason: "one" },
        { path: `${PROJECT_DIRECTORY}/node_modules/b/hexagon.json`, reason: "two" },
      ]),
    ]);
    expect(messages(set)[0]).toContain(
      "(`node_modules/a/hexagon.json` could not be read: one; " +
        "`node_modules/b/hexagon.json` could not be read: two)",
    );
  });

  /**
   * §9 (e): a manifest the walk cannot read that stopped nothing is silent by
   * choice — "a broken manifest that answered nothing broke nothing".
   */
  test("an unreadable manifest a lookup answered around is silent", () => {
    const acme = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme`);
    const set = validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [acme], [
        { path: "/work/node_modules/@junk/x/hexagon.json", reason: "not JSON" },
      ]),
    ]);
    expect(set.problems).toEqual([]);
  });
});

describe("§7 — an installed package that ships no Hexagon source", () => {
  test("the stage-one row, seated at the entry that reached the package", () => {
    const acme: PackageRecord = {
      ...record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme`),
      hasSource: false,
    };
    const set = validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [acme]),
    ]);
    expect(set.problems).toEqual([{
      message: "`Acme` ships no Hexagon source; a Hexagon package is installed as " +
        "source until compiled distribution exists",
      directory: PROJECT_DIRECTORY,
      key: "dependencies",
      entry: "Acme",
    }]);
  });

  test("a package that ships source draws nothing, and neither does an unanswered field", () => {
    const withSource: PackageRecord = {
      ...record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme`),
      hasSource: true,
    };
    expect(messages(validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [withSource]),
    ]))).toEqual([]);
    // A record built with no answer to the question is a package set someone
    // assembled by hand, not a distribution: inventing a refusal from a missing
    // field would refuse every one of them.
    expect(messages(validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme`)]),
    ]))).toEqual([]);
  });
});

describe("§4.3 — one copy of a package per program", () => {
  /** §9 (e)'s nested duplicate, in full: two entries reach two directories. */
  test("two entries reaching two directories are refused, both named with versions", () => {
    const outer = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/@acme/geometry`, [], "2.1.0");
    const bolt = record_("Bolt", `${PROJECT_DIRECTORY}/node_modules/@bolt/tools`, ["Acme"]);
    const inner = record_(
      "Acme",
      `${bolt.directory}/node_modules/@acme/geometry`,
      [],
      "1.4.0",
    );
    const set = validatePackageSet(project_(["Acme", "Bolt"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [outer]),
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
      edge_(bolt.directory, "Acme", [inner]),
    ]);
    expect(messages(set)).toEqual([
      "package `Acme` is installed twice: `node_modules/@acme/geometry` (2.1.0) and " +
        "`node_modules/@bolt/tools/node_modules/@acme/geometry` (1.4.0); a program " +
        "holds one copy of each Hexagon package",
    ]);
  });

  /** §9 (e)'s one-level pair: two roots at one level declaring the requested name. */
  test("two roots at one level declaring the requested name are refused", () => {
    const set = validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [
        record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme-a`, [], "1.0.0"),
        record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme-b`, [], "1.0.0"),
      ]),
    ]);
    expect(messages(set)).toEqual([
      "package `Acme` is installed twice: `node_modules/acme-a` (1.0.0) and " +
        "`node_modules/acme-b` (1.0.0); a program holds one copy of each Hexagon package",
    ]);
  });

  test("a directory the report must climb to is printed climbing", () => {
    const outer = record_("Acme", "/work/node_modules/acme");
    const bolt = record_("Bolt", `${PROJECT_DIRECTORY}/node_modules/bolt`, ["Acme"]);
    const inner = record_("Acme", `${bolt.directory}/node_modules/acme`);
    const set = validatePackageSet(project_(["Acme", "Bolt"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [outer]),
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
      edge_(bolt.directory, "Acme", [inner]),
    ]);
    expect(messages(set)[0]).toContain("`../node_modules/acme`");
  });

  /**
   * §9 (e): a copy in an ancestor's `node_modules` that the nearest level
   * shadowed for every walk is no package in the program and refuses nothing.
   */
  test("a shadowed ancestor copy no edge answered with is refused by nothing", () => {
    const nearest = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/@acme/geometry`);
    const set = validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [nearest]),
    ]);
    expect(set.problems).toEqual([]);
    expect(set.packages).toHaveLength(2);
  });

  test("the project's own name installed elsewhere is refused at the manifest", () => {
    const bolt = record_("Bolt", `${PROJECT_DIRECTORY}/node_modules/bolt`, ["Acme"]);
    const acme = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/@acme/geometry`);
    const set = validatePackageSet(record_("Acme", PROJECT_DIRECTORY, ["Bolt"]), [
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
      edge_(bolt.directory, "Acme", [acme]),
    ]);
    expect(messages(set)).toEqual([
      "this project declares `\"name\": \"Acme\"`, and `Acme` is also installed at " +
        "`node_modules/@acme/geometry`; a program holds one package of each name",
    ]);
    expect(set.problems[0]).toMatchObject({ directory: PROJECT_DIRECTORY, key: "name" });
  });

  test("the project listing its own name, found elsewhere, is the same refusal", () => {
    const acme = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/@acme/geometry`);
    const set = validatePackageSet(record_("Acme", PROJECT_DIRECTORY, ["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [acme]),
    ]);
    expect(messages(set)).toContain(
      "this project declares `\"name\": \"Acme\"`, and `Acme` is also installed at " +
        "`node_modules/@acme/geometry`; a program holds one package of each name",
    );
  });

  /**
   * §4.3 reads over an **entry**: "where an entry of the closure resolves the
   * project's own `name` to an installed package at a directory other than the
   * project's own". Two directories declaring it are two entries, so both are
   * named — the one-copy rule skips the project's name precisely because this
   * row has already spoken for it, and naming only the first left the second
   * copy reported nowhere at all.
   */
  test("two installed copies of the project's own name are both refused", () => {
    const bolt = record_("Bolt", `${PROJECT_DIRECTORY}/node_modules/bolt`, ["Acme"]);
    const near = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/@acme/geometry`);
    const far = record_("Acme", `${bolt.directory}/node_modules/acme`);
    const set = validatePackageSet(record_("Acme", PROJECT_DIRECTORY, ["Acme", "Bolt"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [near]),
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
      edge_(bolt.directory, "Acme", [far]),
    ]);
    expect(messages(set)).toEqual([
      "this project declares `\"name\": \"Acme\"`, and `Acme` is also installed at " +
        "`node_modules/@acme/geometry`; a program holds one package of each name",
      "this project declares `\"name\": \"Acme\"`, and `Acme` is also installed at " +
        "`node_modules/bolt/node_modules/acme`; a program holds one package of each name",
    ]);
  });

  test("a project listing its own name that nothing declares draws the unresolvable report", () => {
    const set = validatePackageSet(record_("MyApp", PROJECT_DIRECTORY, ["MyApp"]), [
      edge_(PROJECT_DIRECTORY, "MyApp", []),
    ]);
    expect(messages(set)).toEqual([
      "no installed package declares `\"name\": \"MyApp\"`; install it, or check the " +
        "name in its `hexagon.json`",
    ]);
  });
});

describe("§4.1 — the closure is acyclic", () => {
  test("two packages listing each other are named in order", () => {
    const acme = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme`, ["Bolt"]);
    const bolt = record_("Bolt", `${PROJECT_DIRECTORY}/node_modules/bolt`, ["Acme"]);
    const set = validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [acme]),
      edge_(acme.directory, "Bolt", [bolt]),
      edge_(bolt.directory, "Acme", [acme]),
    ]);
    expect(messages(set)).toEqual(["dependency cycle: `Acme` → `Bolt` → `Acme`"]);
  });

  /** §9 (e): a package listing its own name, found by directory identity. */
  test("a package whose lookup reaches its own directory is the one-package cycle", () => {
    const acme = record_("Acme", `${PROJECT_DIRECTORY}/node_modules/acme`, ["Acme"]);
    const set = validatePackageSet(project_(["Acme"]), [
      edge_(PROJECT_DIRECTORY, "Acme", [acme]),
      edge_(acme.directory, "Acme", [acme]),
    ]);
    expect(messages(set)).toEqual(["dependency cycle: `Acme` → `Acme`"]);
  });

  /**
   * §9 (e)'s workspace case, and choice 7's rule: the link into a sibling's
   * `node_modules` adds an edge to the project already in the set, and the
   * ordinary cycle rule reports the cycle the two edges close.
   */
  test("a workspace link closing a cycle back to the project names the project", () => {
    const bolt = record_("Bolt", "/work/packages/bolt", ["MyApp"]);
    const set = validatePackageSet(record_("MyApp", PROJECT_DIRECTORY, ["Bolt"]), [
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
      edge_(bolt.directory, "MyApp", [record_("MyApp", PROJECT_DIRECTORY, ["Bolt"])]),
    ]);
    expect(messages(set)).toEqual(["dependency cycle: `MyApp` → `Bolt` → `MyApp`"]);
    // No second package: the entry reached a directory already in the set.
    expect(set.packages).toHaveLength(2);
  });

  test("a link alone, listed by nobody, refuses nothing", () => {
    const bolt = record_("Bolt", "/work/packages/bolt");
    const set = validatePackageSet(record_("MyApp", PROJECT_DIRECTORY, ["Bolt"]), [
      edge_(PROJECT_DIRECTORY, "Bolt", [bolt]),
    ]);
    expect(set.problems).toEqual([]);
  });
});

describe("Modules §2.2 — the whole-program first-segment report", () => {
  const context = (
    directEntries: readonly string[],
    bringers: Readonly<Record<string, readonly string[]>>,
  ): FirstSegmentContext => ({
    directEntries,
    bringers: new Map(Object.entries(bringers)),
  });

  test("a dependency's module against another package names all three", () => {
    expect(wholeProgramFirstSegmentMessage(
      "Acme.Tools",
      "Bolt",
      "Acme",
      false,
      context(["Acme", "Bolt"], { Acme: ["Acme"], Bolt: ["Bolt"] }),
    )).toBe(
      "module `Acme.Tools` of package `Bolt` begins with the name of the package " +
        "`Acme`, also in this program; drop the dependency that brings `Acme` or " +
        "the one that brings `Bolt`, or combine them once `Acme` is renamed or " +
        "`Bolt` renames its module",
    );
  });

  test("the project's own module against a package it reaches transitively", () => {
    expect(wholeProgramFirstSegmentMessage(
      "Acme.Parser",
      undefined,
      "Acme",
      false,
      context(["Bolt"], { Bolt: ["Bolt"], Acme: ["Bolt"] }),
    )).toBe(
      "module `Acme.Parser` of the project begins with the name of the package " +
        "`Acme`, also in this program (brought in by `Bolt`); rename the module, " +
        "or drop the dependency that brings `Acme`",
    );
  });

  test("a dependency's module against the project's own name", () => {
    expect(wholeProgramFirstSegmentMessage(
      "MyApp.Tools",
      "Bolt",
      "MyApp",
      true,
      context(["Bolt"], { Bolt: ["Bolt"] }),
    )).toBe(
      "module `MyApp.Tools` of package `Bolt` begins with the name of this " +
        "project, `MyApp`; rename the project or drop its manifest `name`, drop " +
        "the dependency that brings `Bolt`, or combine them once `Bolt` renames " +
        "its module",
    );
  });

  test("a package that is not a direct entry carries its bringer after the phrase naming it", () => {
    expect(wholeProgramFirstSegmentMessage(
      "Acme.Tools",
      "Bolt",
      "Acme",
      false,
      context(["Acme", "Carbide"], { Acme: ["Acme"], Bolt: ["Carbide"] }),
    )).toBe(
      "module `Acme.Tools` of package `Bolt` (brought in by `Carbide`) begins with " +
        "the name of the package `Acme`, also in this program; drop the dependency " +
        "that brings `Acme` or the one that brings `Bolt`, or combine them once " +
        "`Acme` is renamed or `Bolt` renames its module",
    );
  });

  test("a package several entries reach names every bringer and takes the plural repair", () => {
    expect(wholeProgramFirstSegmentMessage(
      "Acme.Tools",
      "Bolt",
      "Acme",
      false,
      context(["Acme", "Carbide", "Bolt"], {
        Acme: ["Acme", "Carbide"],
        Bolt: ["Bolt"],
      }),
    )).toBe(
      "module `Acme.Tools` of package `Bolt` begins with the name of the package " +
        "`Acme`, also in this program (a direct dependency, and brought in by " +
        "`Carbide`); drop the dependencies that bring `Acme` or the one that " +
        "brings `Bolt`, or combine them once `Acme` is renamed or `Bolt` renames " +
        "its module",
    );
  });

  test("one entry bringing both packages collapses the repairs and drops the combine clause", () => {
    const message = wholeProgramFirstSegmentMessage(
      "Acme.Tools",
      "Bolt",
      "Acme",
      false,
      context(["Carbide"], { Acme: ["Carbide"], Bolt: ["Carbide"] }),
    );
    expect(message).toBe(
      "module `Acme.Tools` of package `Bolt` (brought in by `Carbide`) begins with " +
        "the name of the package `Acme`, also in this program (brought in by " +
        "`Carbide`); drop the dependency that brings both `Acme` and `Bolt`",
    );
    expect(message).not.toContain("combine them");
  });

  /**
   * The collapse is "where **one entry** brings both packages named", and one
   * only: an entry that brings both while a second still brings one of them is
   * not an entry whose removal takes both out, so each package keeps its full
   * bringer list and the plural repair stands.
   */
  test("an overlap that is not one shared entry keeps both bringer lists", () => {
    const message = wholeProgramFirstSegmentMessage(
      "Acme.Tools",
      "Bolt",
      "Acme",
      false,
      context(["Carbide", "Chroma"], {
        Acme: ["Carbide", "Chroma"],
        Bolt: ["Carbide"],
      }),
    );
    expect(message).toBe(
      "module `Acme.Tools` of package `Bolt` (brought in by `Carbide`) begins with " +
        "the name of the package `Acme`, also in this program (brought in by " +
        "`Carbide` and `Chroma`); drop the dependencies that bring `Acme` or the " +
        "one that brings `Bolt`, or combine them once `Acme` is renamed or `Bolt` " +
        "renames its module",
    );
  });

  test("two entries each bringing both is not the collapse either", () => {
    const message = wholeProgramFirstSegmentMessage(
      "Acme.Tools",
      "Bolt",
      "Acme",
      false,
      context(["Carbide", "Chroma"], {
        Acme: ["Carbide", "Chroma"],
        Bolt: ["Carbide", "Chroma"],
      }),
    );
    // Dropping *one* of them takes neither package out, so there is no single
    // dependency to name and the sentence must not claim there is.
    expect(message).not.toContain("brings both");
    expect(message).toContain("drop the dependencies that bring `Acme`");
    expect(message).toContain("the ones that bring `Bolt`");
  });
});

describe("§4.1 — how the project reaches a package", () => {
  test("bringers are the project's own entries, however long the chain", () => {
    const project = package_(undefined, ["Bolt", "Carbide"]);
    const bringers = bringersOf(project, [
      project,
      package_("Bolt", ["Acme"]),
      package_("Carbide", ["Acme"]),
      package_("Acme"),
    ]);
    expect(bringers.get("Acme")).toEqual(["Bolt", "Carbide"]);
    expect(bringers.get("Bolt")).toEqual(["Bolt"]);
  });

  test("a cycle among dependencies does not stall the walk", () => {
    const project = package_(undefined, ["Acme"]);
    const bringers = bringersOf(project, [
      project,
      package_("Acme", ["Bolt"]),
      package_("Bolt", ["Acme"]),
    ]);
    expect(bringers.get("Bolt")).toEqual(["Acme"]);
  });
});

describe("§4.3 — a directory as a reader of the project sees it", () => {
  test("a directory beneath the project is printed relative to it", () => {
    expect(relativeDirectory("/work/app", "/work/app/node_modules/acme")).toBe(
      "node_modules/acme",
    );
  });

  test("a directory the walk climbed to climbs in the report too", () => {
    expect(relativeDirectory("/work/app", "/work/node_modules/acme")).toBe(
      "../node_modules/acme",
    );
  });

  test("a path sharing no prefix is printed as it stands", () => {
    expect(relativeDirectory("/work/app", "/opt/acme")).toBe("/opt/acme");
  });
});
