import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for `export constraint` (#276 stage 2; Modules §3.1–§3.3, §4.1,
 * §6.5; Constraints §2.2, §5.1.1, §6.1–§6.5).
 *
 * An exported constraint crosses as a **reference to its declaration**: subject,
 * base constraints, member schemes, defaults, and implied types do not travel
 * separately, because they are the declaration. What this file pins is that the
 * importing module discharges requirements against *that* declaration — never
 * against one it re-derived from a name it happens to share — and that emission
 * plumbs the members and the defaults across without changing any semantics.
 *
 * Fixtures are deliberately not near-copies of each other. Two conformance
 * modules whose emitted JavaScript is byte-identical share one ESM `data:`
 * module instance in the test linker, which quietly turns a two-module program
 * into a one-module one.
 */

const messagesOf = (files: readonly (readonly [string, string])[]): readonly string[] =>
  compileFiles(files).diagnostics.map(({ message }) => message);

/** The JavaScript emitted for one path. */
function emitted(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const project = compileFiles(files);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`no emitted module at ${path}`);
  return module.javascript.text;
}

describe("importing a constraint brings its members (Modules §3.1)", () => {
  const files = [
    ["/labels.hex", [
      "export constraint Label<a> =",
      "    label(subject: a): String",
      "",
      "honor Label<Int> =",
      "    label(n) = \"#${n}\"",
      "",
    ].join("\n")],
    ["/main.hex", [
      "import { Label } from \"./labels\"",
      "",
      "record Room = {number: Int}",
      "",
      "honor Label<Room> =",
      "    label(r) = \"room ${r.number}\"",
      "",
      "let four: Int = 4",
      "export fun describeRoom(): String = label(Room({number = 12}))",
      "export fun describeCount(): String = label(four)",
      "",
    ].join("\n")],
  ] as const;

  test("the member is callable and the instances are the honored ones", async () => {
    const exports = await runProject(files);

    expect((exports.describeRoom as () => string)()).toBe("room 12");
    expect((exports.describeCount as () => string)()).toBe("#4");
  });

  test("the importer reaches the member through the home module's forwarder", () => {
    // §6.5: the forwarder is exported under the internal plumbing name, and the
    // importer binds it back to the member's own spelling. Not in the `.d.ts`.
    expect(emitted(files, "/labels.hex")).toContain("export { label as __hex_export");
    expect(emitted(files, "/main.hex")).toMatch(
      /import \{ __hex_export\d+ as label \} from "\.\/labels\.js";/u,
    );
  });

  test("no constraint machinery reaches the declaration file (§6.4)", () => {
    const project = compileFiles(files);
    const labels = project.modules.find(({ source }) => source.path === "/labels.hex")!;

    expect(labels.declarations.text).not.toContain("Label");
    expect(labels.declarations.text).not.toContain("label");
  });
});

describe("an unexported constraint stays private", () => {
  const home = [
    "constraint Whisper<a> =",
    "    whisper(subject: a): String",
    "",
    "honor Whisper<Int> =",
    "    whisper(n) = \"psst ${n}\"",
    "",
    "export fun quietly(n: Int): String = whisper(n)",
    "",
  ].join("\n");

  test("its name is not an export", () => {
    expect(messagesOf([
      ["/quiet.hex", home],
      ["/main.hex", "import { Whisper } from \"./quiet\"\n\nexport fun go(): Int = 1\n"],
    ])).toEqual(["module `./quiet` does not export `Whisper`"]);
  });

  test("neither is a member of it", () => {
    expect(messagesOf([
      ["/quiet.hex", home],
      ["/main.hex", "import { whisper } from \"./quiet\"\n\nexport fun go(): Int = 2\n"],
    ])).toEqual(["module `./quiet` does not export `whisper`"]);
  });

  test("its emission is unchanged by the feature", () => {
    // The byte-for-byte guard on §6.5's "for an unexported constraint nothing
    // changes": no forwarder export, no hoisted helper, the default copied into
    // the honoring dictionary as before.
    const text = emitted([["/main.hex", [
      "constraint Greet<a> =",
      "    greet(subject: a): String",
      "    greetLoudly(subject: a): String = greet(subject) ++ \"!\"",
      "",
      "honor Greet<Int> =",
      "    greet(n) = \"hi ${n}\"",
      "",
      "export fun shout(n: Int): String = greetLoudly(n)",
      "",
    ].join("\n")]], "/main.hex");

    expect(text).not.toContain("__hex_default");
    expect(text).not.toContain("__hex_export");
    expect(text).toContain("greetLoudly: ");
  });
});

/**
 * A two-level constraint hierarchy in one module, both levels exported. `Loud`
 * extends `Describe`, so a `Loud` dictionary carries the `Describe` one in its
 * `describe`-named slot (Constraints §6.2) and a function constrained `<a: Loud>`
 * reaches `describe` as `dict.describe.describe`.
 */
const hierarchy = [
  "export constraint Describe<a> =",
  "    describe(subject: a): String",
  "",
  "export constraint Loud<a: Describe> =",
  "    shout(subject: a): String",
  "",
  "export record Metre = {span: Int}",
  "",
  "honor Describe<Metre> =",
  "    describe(m) = \"${m.span}m\"",
  "",
  "honor Loud<Metre> =",
  "    shout(m) = describe(m)",
  "",
].join("\n");

describe("base-constraint entailment through an imported constraint", () => {
  const files = [
    ["/units.hex", hierarchy],
    ["/main.hex", [
      "import { Describe, Loud, Metre } from \"./units\"",
      "",
      "export fun banner<a: Loud>(subject: a): String =",
      "    shout(subject) ++ \" (\" ++ describe(subject) ++ \")\"",
      "",
      "export fun run(): String = banner(Metre({span = 5}))",
      "",
    ].join("\n")],
  ] as const;

  test("the base member is reached through the slot chain", () => {
    // The path is the whole point (§6.2). `describe` inside `banner` must
    // receive a projection out of the one `Loud` dictionary the caller passed;
    // before base constraints travelled with their identities the importer's
    // walk found no bases, and the slot-less `Loud` dictionary went to the
    // `Describe` seat — a miscompile with no diagnostic.
    expect(emitted(files, "/main.hex")).toMatch(
      /describe\(subject, __hex_dictLoud_\d+\.describe\)/u,
    );
  });

  test("and produces the base instance's answer at run time", async () => {
    const exports = await runProject(files);

    expect((exports.run as () => string)()).toBe("5m (5m)");
  });

  test("a requirement may name an extending constraint the importer never imports", async () => {
    // The unnameable case. `/tip.hex` holds only `banner`'s scheme, whose
    // requirement demands `Loud` — a constraint it does not import and cannot
    // spell. Discharging it still has to walk `Loud`'s bases to find the
    // `Describe` slot, which is why the metadata channel is transitive and keyed
    // on the declaration rather than the name.
    const exports = await runProject([
      ["/units.hex", hierarchy],
      ["/middle.hex", [
        "import { Describe, Loud, Metre } from \"./units\"",
        "",
        "export fun banner<a: Loud>(subject: a): String =",
        "    shout(subject) ++ \" (\" ++ describe(subject) ++ \")\"",
        "",
        "export fun oneMetre(): Metre = Metre({span = 1})",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { banner, oneMetre } from \"./middle\"",
        "",
        "export fun run(): String = banner(oneMetre())",
        "",
      ].join("\n")],
    ]);

    expect((exports.run as () => string)()).toBe("1m (1m)");
  });

  test("a local constraint of the same name does not answer the imported one", () => {
    // §5.1.1 across the export boundary: `main`'s own `Loud` is a different
    // declaration, so the imported `banner`'s requirement is not satisfied by
    // the local instance and the local `blare` is not `Loud`'s member.
    expect(messagesOf([
      ["/units.hex", hierarchy],
      ["/middle.hex", [
        "import { Loud } from \"./units\"",
        "",
        "export fun banner<a: Loud>(subject: a): String = shout(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { banner } from \"./middle\"",
        "",
        "record Siren = {pitch: Int}",
        "",
        "constraint Loud<a> =",
        "    blare(subject: a): String",
        "",
        "honor Loud<Siren> =",
        "    blare(s) = \"weeee\"",
        "",
        "export fun run(): String = banner(Siren({pitch = 3}))",
        "",
      ].join("\n")],
    ])).toEqual(["type `Siren` has no `Loud` instance"]);
  });
});

describe("the orphan rule reads files, never imports (Constraints §5.3)", () => {
  test("`honor ImportedC<LocalT>` is lawful — the subject's home is this file", () => {
    expect(messagesOf([
      ["/units.hex", hierarchy],
      ["/main.hex", [
        "import { Describe } from \"./units\"",
        "",
        "record Furlong = {chains: Int}",
        "",
        "honor Describe<Furlong> =",
        "    describe(f) = \"${f.chains} chains\"",
        "",
        "export fun run(): String = describe(Furlong({chains = 8}))",
        "",
      ].join("\n")],
    ])).toEqual([]);
  });

  test("`honor ImportedC<ImportedT>` in a third module is the §5.3 error", () => {
    // Visible is not the same as owned. Both homes are elsewhere, so this module
    // has no claim on the pair however many of its names it can spell.
    expect(messagesOf([
      ["/units.hex", hierarchy],
      ["/rods.hex", [
        "export record Rod = {poles: Int}",
        "",
        "export fun oneRod(): Rod = Rod({poles = 1})",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Describe } from \"./units\"",
        "import { Rod } from \"./rods\"",
        "",
        "honor Describe<Rod> =",
        "    describe(r) = \"a rod\"",
        "",
        "export fun run(): Int = 0",
        "",
      ].join("\n")],
    ])).toEqual([
      "orphan instance: this module declares neither `Describe` nor the instance subject",
    ]);
  });

  test("an importer does not re-report the home module's base-constraint faults", () => {
    // `#checkBaseConstraintGraph` is the home module's business. Its one report
    // must appear once, at the declaration, not once per importer.
    const messages = messagesOf([
      ["/broken.hex", [
        "export constraint Ring<a: Chain> =",
        "    ring(subject: a): Int",
        "",
        "export constraint Chain<a: Ring> =",
        "    chain(subject: a): Int",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Ring } from \"./broken\"",
        "",
        "export fun run(): Int = 7",
        "",
      ].join("\n")],
    ]);

    expect(messages.filter((message) => message.startsWith("base constraint cycle")))
      .toHaveLength(1);
  });
});

describe("defaults hoist once, at home (Constraints §6.5)", () => {
  /** The default body reaches a **private** helper of its own module. */
  const stamps = [
    "export constraint Stamp<a> =",
    "    mark(subject: a): String",
    "    stamped(subject: a): String = decorate(mark(subject))",
    "",
    "fun decorate(text: String): String = \"<< \" ++ text ++ \" >>\"",
    "",
    "export record Seal = {sigil: String}",
    "",
    "honor Stamp<Seal> =",
    "    mark(s) = s.sigil",
    "",
  ].join("\n");

  const files = [
    ["/stamps.hex", stamps],
    ["/main.hex", [
      "import { Stamp, Seal } from \"./stamps\"",
      "",
      "record Ticket = {serial: String}",
      "",
      "honor Stamp<Ticket> =",
      "    mark(t) = \"no. \" ++ t.serial",
      "",
      "export fun homeSide(): String = stamped(Seal({sigil = \"wax\"}))",
      "export fun awaySide(): String = stamped(Ticket({serial = \"117\"}))",
      "",
    ].join("\n")],
  ] as const;

  test("the body emits once, in the module that wrote it", () => {
    const home = emitted(files, "/stamps.hex");

    expect(home).toMatch(/const __hex_default\d+ = /u);
    expect(home).toMatch(/export \{ __hex_default\d+ \};/u);
    // One call to the private helper, not one copy of the body per honoring
    // instance — and the sibling member reached through the dictionary the
    // helper was handed, so an override would win (§2, §6.3).
    expect(home).toMatch(
      /const __hex_default\d+ = \(__hex_dict, subject\) => decorate\(mark\(subject, __hex_dict\)\);/u,
    );
    expect(home.match(/=> decorate\(/gu)).toHaveLength(1);
    expect(home).not.toContain("stamped: subject =>");
  });

  test("both inheritors fill the slot by reference, and the private helper still runs", async () => {
    // What hoisting exists for: `decorate` is unexported, so a copy of the body
    // in `/main.hex` could not resolve it at all.
    const exports = await runProject(files);

    expect((exports.homeSide as () => string)()).toBe("<< wax >>");
    expect((exports.awaySide as () => string)()).toBe("<< no. 117 >>");
  });

  test("the importing module imports the helper and defers the call", () => {
    const away = emitted(files, "/main.hex");

    expect(away).toMatch(
      /import \{[^}]*__hex_default\d+[^}]*\} from "\.\/stamps\.js";/u,
    );
    // Deferred, never eager: the dictionary const is not initialized while its
    // own literal is under construction (§6.3).
    expect(away).toMatch(/stamped: __hex_arg0 => __hex_default\d+\(__hex_instance/u);
  });

  test("a default calling a sibling member dispatches through the completed instance", async () => {
    // §2's rule, unchanged by hoisting: the override must win, and it can only
    // win if the default reads the slot off the dictionary at call time.
    const exports = await runProject([
      ["/chimes.hex", [
        "export constraint Chime<a> =",
        "    note(subject: a): String",
        "    peal(subject: a): String = note(subject) ++ note(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Chime } from \"./chimes\"",
        "",
        "record Bell = {tone: String}",
        "record Gong = {tone: String}",
        "",
        "honor Chime<Bell> =",
        "    note(b) = b.tone",
        "",
        "honor Chime<Gong> =",
        "    note(g) = g.tone",
        "    peal(g) = \"BONG\"",
        "",
        "export fun inherited(): String = peal(Bell({tone = \"ding\"}))",
        "export fun overridden(): String = peal(Gong({tone = \"low\"}))",
        "",
      ].join("\n")],
    ]);

    expect((exports.inherited as () => string)()).toBe("dingding");
    expect((exports.overridden as () => string)()).toBe("BONG");
  });
});

describe("a parameterized honor of an imported constraint", () => {
  test("recursive member use reaches the instance under construction", async () => {
    const exports = await runProject([
      ["/renders.hex", [
        "export constraint Render<a> =",
        "    render(subject: a): String",
        "",
        "honor Render<Int> =",
        "    render(n) = \"${n}\"",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Render } from \"./renders\"",
        "",
        "union Nest(a) = Leaf(value: a) | Wrap(inner: Nest(a))",
        "",
        "honor<a: Render> Render<Nest(a)> =",
        "    render(n) =",
        "        match n",
        "            Leaf(value) => render(value)",
        "            Wrap(inner) => \"(\" ++ render(inner) ++ \")\"",
        "",
        "let three: Int = 3",
        "export fun run(): String = render(Wrap(Wrap(Leaf(three))))",
        "",
      ].join("\n")],
    ]);

    expect((exports.run as () => string)()).toBe("((3))");
  });
});

describe("aliased and namespace imports (Modules §3.2, §3.3)", () => {
  test("an alias renames the constraint only; members keep their names", async () => {
    const exports = await runProject([
      ["/weights.hex", [
        "export constraint Weigh<a> =",
        "    grams(subject: a): Int",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Weigh as Heft } from \"./weights\"",
        "",
        "record Brick = {count: Int}",
        "",
        "honor Heft<Brick> =",
        "    grams(b) = b.count",
        "",
        "export fun total<a: Heft>(subject: a): Int = grams(subject)",
        "export fun run(): Int = total(Brick({count = 900}))",
        "",
      ].join("\n")],
    ]).then((exports) => exports);

    expect((exports.run as () => number)()).toBe(900);
  });

  test("an alias round-trips through a second export", async () => {
    const exports = await runProject([
      ["/weights.hex", [
        "export constraint Weigh<a> =",
        "    grams(subject: a): Int",
        "",
        "export record Anvil = {mass: Int}",
        "",
        "honor Weigh<Anvil> =",
        "    grams(a) = a.mass",
        "",
      ].join("\n")],
      ["/middle.hex", [
        "import { Weigh as Heft, Anvil } from \"./weights\"",
        "",
        "export fun weighed<a: Heft>(subject: a): Int = grams(subject)",
        "export fun anvil(): Anvil = Anvil({mass = 40})",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { weighed, anvil } from \"./middle\"",
        "",
        "export fun run(): Int = weighed(anvil())",
        "",
      ].join("\n")],
    ]);

    expect((exports.run as () => number)()).toBe(40);
  });

  test("a namespace-imported constraint may be honored for a local type", async () => {
    // The only spelling available to a module that reached the constraint this
    // way, and its own type is a lawful home for the instance (§5.3).
    const exports = await runProject([
      ["/geo.hex", [
        "export constraint Perimeter<a> =",
        "    around(subject: a): Int",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import * as Geo from \"./geo\"",
        "",
        "record Triangle = {side: Int}",
        "",
        "honor Geo.Perimeter<Triangle> =",
        "    around(t) = t.side * 3",
        "",
        "export fun run(): Int = Geo.around(Triangle({side = 5}))",
        "",
      ].join("\n")],
    ]);

    expect((exports.run as () => number)()).toBe(15);
  });

  test("a namespace import qualifies the constraint in a binder and its member as a term", async () => {
    const exports = await runProject([
      ["/geo.hex", [
        "export constraint Area<a> =",
        "    area(subject: a): Int",
        "",
        "export record Square = {side: Int}",
        "",
        "honor Area<Square> =",
        "    area(s) = s.side * s.side",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import * as Geo from \"./geo\"",
        "",
        "export fun sized<a: Geo.Area>(subject: a): Int = Geo.area(subject)",
        "export fun run(): Int = sized(Geo.Square({side = 7}))",
        "",
      ].join("\n")],
    ]);

    expect((exports.run as () => number)()).toBe(49);
  });
});

describe("implied types project through an imported member", () => {
  // The projection is what makes `first` return `String` here rather than an
  // unresolved implied type. It runs off the member's *own* constraint
  // (`#instantiate`), and a scheme that crossed the boundary carrying only
  // "constrained function" had nothing to run it from.
  const files = [
    ["/streams.hex", [
      "export constraint Source<a> =",
      "    type Item",
      "    peek(supply: a): Item",
      "",
      "export record Ledger = {entries: Vector(String)}",
      "",
      "honor Source<Ledger> =",
      "    type Item = String",
      "    peek(l) = \"entry\"",
      "",
    ].join("\n")],
    ["/main.hex", [
      "import { Source, Ledger } from \"./streams\"",
      "",
      "export fun first(): String = peek(Ledger({entries = []}))",
      "",
    ].join("\n")],
  ] as const;

  test("the member's result is the instance's implied type", () => {
    expect(messagesOf(files)).toEqual([]);
  });

  test("an importing module can honor it and bind the implied type", async () => {
    // The `type Item = ...` binding names a member of the *imported*
    // declaration, so the resolver's owner table — which knows only this
    // module's own constraints — is not the place to look it up.
    const exports = await runProject([
      files[0],
      ["/main.hex", [
        "import { Source } from \"./streams\"",
        "",
        "record Register = {rows: Int}",
        "",
        "honor Source<Register> =",
        "    type Item = Int",
        "    peek(r) = r.rows",
        "",
        "export fun rows(): Int = peek(Register({rows = 9}))",
        "",
      ].join("\n")],
    ]);

    expect((exports.rows as () => number)()).toBe(9);
  });

  test("and a wrongly typed use is caught against it", () => {
    expect(messagesOf([
      files[0],
      ["/main.hex", [
        "import { Source, Ledger } from \"./streams\"",
        "",
        "export fun first(): Int = peek(Ledger({entries = []}))",
        "",
      ].join("\n")],
    ])).toContain("type mismatch: expected Int, found String");
  });
});

describe("collisions (Modules §5.2)", () => {
  test("an imported constraint collides with a local declaration of the name", () => {
    expect(messagesOf([
      ["/units.hex", hierarchy],
      ["/main.hex", [
        "import { Describe } from \"./units\"",
        "",
        "constraint Describe<a> =",
        "    describe(subject: a): String",
        "",
      ].join("\n")],
    ])).toContain("constraint `Describe` is already declared or imported");
  });

  test("two imported constraints of the same name collide at the second import", () => {
    expect(messagesOf([
      ["/units.hex", hierarchy],
      ["/echoes.hex", [
        "export constraint Describe<a> =",
        "    describe(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Describe } from \"./units\"",
        "import { Describe } from \"./echoes\"",
        "",
      ].join("\n")],
    ])).toContain("constraint `Describe` is already declared or imported");
  });

  test("two imported constraints sharing a member name collide on the member", () => {
    // Constraint members are ordinary module-scope terms (Constraints §2.2), so
    // the collision is the ordinary rebinding one.
    expect(messagesOf([
      ["/units.hex", hierarchy],
      ["/echoes.hex", [
        "export constraint Narrate<a> =",
        "    describe(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Describe } from \"./units\"",
        "import { Narrate } from \"./echoes\"",
        "",
      ].join("\n")],
    ]).some((message) => message.startsWith("`describe` is already bound"))).toBe(true);
  });

  test("a local term of the member's name collides too", () => {
    expect(messagesOf([
      ["/units.hex", hierarchy],
      ["/main.hex", [
        "fun describe(n: Int): String = \"local\"",
        "",
        "import { Describe } from \"./units\"",
        "",
      ].join("\n")],
    ]).some((message) => message.startsWith("`describe` is already bound"))).toBe(true);
  });
});

describe("members cannot be imported severally (Modules §3.1, §12.4)", () => {
  test("naming one gets the constraint it belongs to", () => {
    expect(messagesOf([
      ["/sizes.hex", [
        "export constraint Sized<a> =",
        "    magnitude(subject: a): Int",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { magnitude } from \"./sizes\"",
        "",
        "export fun go(): Int = 3",
        "",
      ].join("\n")],
    ])).toEqual([
      "`magnitude` is a member of constraint `Sized`; import the constraint — " +
      "its members arrive with it",
    ]);
  });
});

describe("`export honor` and `export opaque constraint` (Modules §4.1, §10)", () => {
  test("`export honor` names the rule rather than the grammar", () => {
    expect(messagesOf([["/main.hex", [
      "constraint Tally<a> =",
      "    tally(subject: a): Int",
      "",
      "export honor Tally<Int> =",
      "    tally(n) = n",
      "",
    ].join("\n")]])).toContain(
      "instances are always visible; `export` does not apply",
    );
  });

  test("`export opaque constraint` names where `opaque` applies", () => {
    expect(messagesOf([["/main.hex", [
      "export opaque constraint Hidden<a> =",
      "    peek(subject: a): Int",
      "",
    ].join("\n")]])).toContain(
      "`opaque` applies to `record` and `union` declarations",
    );
  });
});
