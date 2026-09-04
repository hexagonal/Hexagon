import { describe, expect, test } from "vitest";

import {
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
  resolveModuleName,
  visiblePackages,
} from "./packages.js";

/**
 * Unit conformance for `spec/packages.md`'s resolution and naming rules.
 *
 * `compileProject` reaches this file with the package set `{project, Hex}`,
 * which is every dependency the first host slice has (Packages §5.1, PR A's
 * choice 5). The branches it *cannot* reach yet — a contested name, a first
 * segment naming an installed package the resolver does not list — ship with
 * byte-exact §10 wording, and this is where that wording is executed until a
 * real dependency package makes it reachable end to end.
 */

const HEX: ProgramPackage = { name: "Hex", dependencies: [] };

function module_(packageName: string | undefined, declaredName: string): ProgramModule {
  return { packageName, declaredName, fullName: fullModuleName(packageName, declaredName) };
}

function indexOf(...modules: readonly ProgramModule[]): ModuleIndex {
  return {
    byFullName: new Map(modules.map((module) => [module.fullName, module])),
    packages: [],
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
    expect(visiblePackages({ name: "MyApp", dependencies: ["Acme", "Bolt"] })).toEqual([
      "MyApp",
      "Hex",
      "Acme",
      "Bolt",
    ]);
  });

  test("an unnamed project is the `undefined` seat, and `Hex` is never doubled", () => {
    expect(visiblePackages({ name: undefined, dependencies: [] })).toEqual([undefined, "Hex"]);
    expect(visiblePackages(HEX)).toEqual(["Hex"]);
  });

  test("a dependency's own dependencies are invisible", () => {
    expect(visiblePackages({ name: undefined, dependencies: ["Bolt"] })).not.toContain("Acme");
  });
});

describe("§3.4 — resolving one written module name", () => {
  const project: ProgramPackage = { name: undefined, dependencies: ["Acme"] };

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

  /** §3.3's contest — unreachable from `compileProject` until PR C. */
  test("a name two visible packages provide is contested, both named", () => {
    const resolution = resolveModuleName(
      "Geometry",
      project,
      indexOf(module_("Acme", "Geometry"), module_("Hex", "Geometry")),
    );
    expect(resolution.kind).toBe("Contested");
    expect(resolution.kind === "Contested" ? resolution.providers.map(({ fullName }) => fullName) : [])
      .toEqual(["Hex.Geometry", "Acme.Geometry"]);
  });

  test("a package qualifying its own module is refused, the declared name named", () => {
    expect(resolveModuleName(
      "MyApp.Geometry",
      { name: "MyApp", dependencies: [] },
      indexOf(module_("MyApp", "Geometry")),
    )).toEqual({ kind: "SelfQualified", declaredName: "Geometry" });
  });

  /** §7 — unreachable until an installed set exists to check against. */
  test("a first segment naming an installed package the resolver does not list", () => {
    expect(resolveModuleName(
      "Acme.Tools",
      { name: undefined, dependencies: ["Bolt"] },
      indexOf(module_("Bolt", "Widgets")),
      new Set(["Acme"]),
    )).toEqual({ kind: "NotADependency", packageName: "Acme" });
  });

  test("the manifest edit is withheld where a module is declared under that segment", () => {
    // §3.3's proviso: applying it would refuse that module (Modules §2.2), so
    // the unknown-module report fires instead.
    expect(resolveModuleName(
      "Acme.Missing",
      { name: undefined, dependencies: ["Bolt"] },
      indexOf(module_("Bolt", "Acme.Tools")),
      new Set(["Acme"]),
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
      { name: undefined, dependencies: [] },
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

  test("an npm-shaped entry is a JavaScript package, bound with `extern`", () => {
    expect(dependencyRefusal("tiny-json")).toBe(
      "`tiny-json` is not a Hexagon package: bind it with `extern from \"tiny-json\"`",
    );
    expect(dependencyRefusal("@scope/pkg")).toBe(
      "`@scope/pkg` is not a Hexagon package: bind it with `extern from \"@scope/pkg\"`",
    );
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
});
