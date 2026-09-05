import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";
import { LIBRARY_MODULES, PRELUDE_MODULES } from "../prelude.js";
import { RUNTIME_MODULES } from "../runtime-modules.js";

/**
 * The standard library is the package `Hex`, **in full** (Packages §2.4, §3.2;
 * #829).
 *
 * The compiler embeds every `stdlib/` module, not the prelude alone, and the
 * three lists it sorts them into decide three different things:
 *
 * - **the prelude** (`PRELUDE_MODULES`) is bare scope, and #742's set is closed:
 *   nothing here may grow it;
 * - **the runtime modules** (`RUNTIME_MODULES`) hold the two compilation
 *   privileges, keyed by membership in that list and never by a path;
 * - **the rest** (`LIBRARY_MODULES`) is reached the way any other package's
 *   module is — `import Rat` where the resolving package declares no `Rat`,
 *   `import Hex.Rat` always, occluded silently by a project's own `module Rat`.
 *
 * What every one of them shares is emission: a `Hex` module writes a file only
 * where the program reaches it (§6), so embedding the whole library costs a
 * program that imports none of it exactly nothing.
 *
 * These tests are written against `compileFiles` — a real project, with no file
 * supplied by any host — because "no host supplies it" is half of what the
 * ruling says. Before it, the Playground handed `Rat.hex` to the compiler as a
 * file of the user's own project, and the two facts below were both false:
 * `import Hex.Rat` named no module, and a buffer's own `module Rat` was a
 * duplicate declaration rather than an occlusion.
 */

/** Every module the project would write a file for, by layout path. */
function emittedPaths(files: readonly (readonly [string, string])[]): readonly string[] {
  const project = compileFiles(files);
  expect(project.diagnostics).toEqual([]);
  return project.modules.map(({ path }) => path);
}

describe("the rest of `Hex` is reachable, under both spellings", () => {
  test.each([
    ["the bare name", "import Rat"],
    ["the full name", "import Hex.Rat"],
    ["the bare name, realiased", "import Rat as R"],
    ["the full name, realiased", "import Hex.Rat as R"],
  ])("%s reaches the one module `Hex.Rat`", (_label, head) => {
    const alias = head.endsWith(" as R") ? "R" : "Rat";
    const project = compileFiles([[
      "/main.hex",
      `module Main\n\n${head}\n\nDebug.log("\${${alias}.create(1, 2)}")\n`,
    ]]);
    expect(project.diagnostics).toEqual([]);
    // One module, one file, whichever spelling reached it: the alias is the
    // importer's, the address is the module's (Packages §6).
    expect(project.modules.map(({ path }) => path)).toContain("/Hex/Rat.hex");
    expect(
      project.modules.find(({ path }) => path === "/Main.hex")!.javascript.text,
    ).toContain(`import * as ${alias} from "./Hex/Rat.js";`);
  });

  /**
   * Half of "embedded" is "not emitted". The whole standard library compiles
   * with every program now, so a program that touches none of it must be
   * byte-identical to what a prelude-only compilation gave it.
   */
  test("a program reaching no library module writes none of their files", () => {
    const paths = emittedPaths([["/main.hex", 'module Main\n\nDebug.log("hello")\n']]);
    for (const { name } of LIBRARY_MODULES) {
      expect(paths, name).not.toContain(`/Hex/${name.replaceAll(".", "/")}.hex`);
    }
    expect(paths).toContain("/Hex/Debug.hex");
  });

  /** And it really does run, rather than merely compiling (Packages §6). */
  test("an imported library module links and runs", async () => {
    expect(
      await runProject([[
        "/main.hex",
        "module Main\n\nimport Rat\n\n" +
          "export let half: String = Rat.show(Rat.create(2, 4))\n",
      ]]),
    ).toMatchObject({ half: "1/2" });
  });
});

describe("a project's own module occludes the library's, silently", () => {
  const OWN_RAT = [
    "/Rat.hex",
    "module Rat\n\nexport let create(value: Int): Int = value\n",
  ] as const;

  test("`import Rat` resolves to the project's own, with no duplicate report", () => {
    const project = compileFiles([
      ["/main.hex", "module Main\n\nimport Rat\n\nexport let n: Int = Rat.create(42)\n"],
      OWN_RAT,
    ]);
    // Packages §3.2: the resolving package's own module wins, and *silently* —
    // a module added to the standard library cannot break a program that
    // already has one of the name.
    expect(project.diagnostics).toEqual([]);
    const paths = project.modules.map(({ path }) => path);
    expect(paths).toContain("/Rat.hex");
    expect(paths).not.toContain("/Hex/Rat.hex");
    // `create` here takes one argument; `Hex.Rat`'s takes two. So this compiles
    // only against the project's own module, which is the claim.
    expect(
      project.modules.find(({ path }) => path === "/Main.hex")!.javascript.text,
    ).toContain('from "./Rat.js"');
  });

  test("`import Hex.Rat` still reaches the library's, beside the project's own", () => {
    const project = compileFiles([
      [
        "/main.hex",
        "module Main\n\nimport Rat\nimport Hex.Rat as Exact\n\n" +
          "export let n: Int = Rat.create(42)\n" +
          "export let half: String = Exact.show(Exact.create(2, 4))\n",
      ],
      OWN_RAT,
    ]);
    expect(project.diagnostics).toEqual([]);
    const paths = project.modules.map(({ path }) => path);
    expect(paths).toContain("/Rat.hex");
    expect(paths).toContain("/Hex/Rat.hex");
  });
});

describe("bare scope is the prelude's, and the library adds nothing to it", () => {
  /**
   * #742's closed set, guarded from the direction #829 opened.
   *
   * Embedding the whole library puts thirty-odd more modules in every
   * compilation, and the one thing that must not follow is a name arriving in
   * bare scope from any of them. `Rat.create` is the specimen because `Rat` is
   * the library module every host used to hand out.
   */
  test("a library module's export is not bare", () => {
    const project = compileFiles([[
      "/main.hex",
      'module Main\n\nDebug.log("${create(1, 2)}")\n',
    ]]);
    expect(project.diagnostics.map(({ message }) => message))
      .toContain("unknown name `create`");
  });

  test("a library module's type is not in scope unimported", () => {
    const project = compileFiles([[
      "/main.hex",
      "module Main\n\nexport let zero: Rat = 0\n",
    ]]);
    expect(project.diagnostics.map(({ message }) => message))
      .toContain("unknown type `Rat`");
  });
});

describe("the runtime modules are members of `Hex`, privileged by name", () => {
  /**
   * Ruling D — **no carve**. `Runtime.VectorTrie` is an ordinary member of the
   * package as far as *import* resolution is concerned: the head binds an
   * alias and nothing is refused there, because there is nothing special to
   * refuse. What the module has is no Hexagon-level exports at all (every
   * operation's type names a private record), so the qualified use draws the
   * ordinary does-not-export report rather than a rule of its own.
   *
   * Stated as a ruling because the alternative was a carve — refusing the
   * import head — and a carve would have been a second rule about a module set
   * the language otherwise has no opinion about.
   */
  test.each([
    ["the declared name", "import Runtime.VectorTrie"],
    ["the full name", "import Hex.Runtime.VectorTrie"],
  ])("%s binds an alias to a module that exports nothing", (_label, head) => {
    const project = compileFiles([[
      "/main.hex",
      `module Main\n\n${head}\n\nexport let n: Int = VectorTrie.size(1)\n`,
    ]]);
    // The import itself is not refused — no "no module", no "not a dependency".
    expect(project.diagnostics.map(({ message }) => message))
      .toEqual(["module `VectorTrie` does not export `size`"]);
  });

  test("the head alone is not an error", () => {
    const project = compileFiles([[
      "/main.hex",
      'module Main\n\nimport Hex.Runtime.HashTrie\n\nDebug.log("hi")\n',
    ]]);
    expect(project.diagnostics).toEqual([]);
  });

  /**
   * Both privileges follow the **name**, and this is the pin that they do:
   * `Node(a)` resolves only in a runtime module, and a project file declaring
   * `module Runtime.VectorTrie` is adopted at that member's seat wherever the
   * file sits — which is the stdlib-developing-itself path, and is why the
   * shipped-sources sweep needs no grant.
   */
  test("a project file declaring a runtime member's name is compiled as one", () => {
    const privileged = compileFiles([[
      "/deep/down/VectorTrie.hex",
      "module Runtime.VectorTrie\n\nlet size(node: Node(Int)): Int = 0\n",
    ]]);
    // `Node(Int)` resolved: the privilege arrived with the name, from a file
    // under a path nothing in the compiler mentions. The one report left is the
    // emitter's own two-sided contract — this stub declares none of the trie's
    // operations — which is `vector-trie-wiring.test.ts`'s seat and is what
    // makes the absence of the `Node` report meaningful rather than vacuous.
    expect(privileged.diagnostics.map(({ message }) => message)).toEqual([
      "this module is `Runtime.VectorTrie` but declares no `empty`, `get`, " +
      "`set`, `append`, `prepend`, `slice`, `window`, `concat`, `nodeRun`",
    ]);
    // The same text under any other name is an ordinary module, and `Node` is
    // not a type it may spell.
    const ordinary = compileFiles([[
      "/deep/down/Trie.hex",
      "module Trie\n\nlet size(node: Node(Int)): Int = 0\n",
    ]]);
    expect(ordinary.diagnostics.map(({ message }) => message))
      .toContain("unknown generic type `Node`");
  });

  test("the runtime members are the two the list names, and no more", () => {
    expect(RUNTIME_MODULES.map(({ name }) => name))
      .toEqual(["Runtime.VectorTrie", "Runtime.HashTrie"]);
    // Neither list may hold the other's members, and the three together are the
    // embedded library — the property `LIBRARY_MODULES` is derived by.
    for (const { name } of RUNTIME_MODULES) {
      expect(PRELUDE_MODULES.map((member) => member.name)).not.toContain(name);
      expect(LIBRARY_MODULES.map((member) => member.name)).not.toContain(name);
    }
    for (const { name } of PRELUDE_MODULES) {
      expect(LIBRARY_MODULES.map((member) => member.name)).not.toContain(name);
    }
  });

  test("a reached runtime module is emitted under its full name's layout", () => {
    const paths = emittedPaths([[
      "/main.hex",
      "module Main\n\nexport let v: Vector(Int) = [1, 2, 3]\n",
    ]]);
    expect(paths).toContain("/Hex/Runtime/VectorTrie.hex");
    expect(paths).not.toContain("/Hex/VectorTrie.hex");
  });
});

/**
 * The third drift guard, beside the prelude's (`prelude-mechanism.test.ts`) and
 * the runtime's (`vector-trie-wiring.test.ts`).
 *
 * `compiler/src/stdlib-sources.ts` is generated from `stdlib/**` by `npm run
 * generate:prelude`, and the compiler ships that copy. An edit to `stdlib/`
 * without the regeneration leaves the compiler shipping stale text — which the
 * two enumerated lists are already guarded against, and the derived one was not:
 * `Rat` today, and "a `Hex` module the moment it lands" by construction, so the
 * set this guards grows on its own.
 */
describe("drift guard: the embedded library matches stdlib/", () => {
  const stdlibSources = import.meta.glob("../../../stdlib/*.hex", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>;

  test("the list is not empty, so the guard below is not vacuous", () => {
    expect(LIBRARY_MODULES.length).toBeGreaterThan(0);
  });

  test.each(LIBRARY_MODULES.map(({ name, source }) => [name, source] as const))(
    "%s is byte-identical to its stdlib original",
    (name, source) => {
      const entry = Object.entries(stdlibSources)
        .find(([path]) => path.endsWith(`/${name.replaceAll(".", "/")}.hex`));
      expect(entry?.[1]).toBe(source);
    },
  );
});
