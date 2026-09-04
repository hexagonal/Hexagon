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

describe("importing a constraint brings its module, and members reach through it (Modules §3.1, #762)", () => {
  // #762 retired the named import that used to put `Label` and its member
  // bare in this module's scope: an import binds the module and nothing
  // smaller, so both the constraint (in a binder or `honor` head) and its
  // member (in a call) are reached through the module alias — `Labels.Label`,
  // `Labels.label`. What the describe block still measures — the forwarder
  // and the seats an importer's uses reach — is unchanged underneath the
  // spelling.
  const files = [
    ["/labels.hex", "module Labels\n\n" + [
      "export constraint Label<a> =",
      "    label(subject: a): String",
      "",
      "honor Label<Int> =",
      "    label(n) = \"#${n}\"",
      "",
    ].join("\n")],
    ["/main.hex", "module Main\n\n" + [
      "import Labels",
      "",
      "record Room = {number: Int}",
      "",
      "honor Labels.Label<Room> =",
      "    label(r) = \"room ${r.number}\"",
      "",
      "let four: Int = 4",
      "export fun describeRoom(): String = Labels.label(Room({number = 12}))",
      "export fun describeCount(): String = Labels.label(four)",
      // The polymorphic control: `a` is a type variable at the call, so this is
      // the one route that still reaches the forwarder (#444).
      "export fun describeAny<a: Labels.Label>(x: a): String = Labels.label(x)",
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
    //
    // Since #444 only the *genuinely polymorphic* call takes that route:
    // `describeAny`'s head is a type variable, so its evidence rides the
    // trailing suffix as it always did.
    expect(emitted(files, "/labels.hex")).toContain("export { label as __label };");
    const main = emitted(files, "/main.hex");
    expect(main).toContain('import { __label } from "./labels.js";');
    expect(main).toContain("return __label(x, __Label_a);");
    // The two concrete calls reach their instances' seats instead — the local
    // one by name, the imported one through the declaring module (§6.1).
    expect(main).toContain('import { __Label_Int_label } from "./labels.js";');
    expect(main).toContain("__Label_Room_label({ number: 12 })");
    expect(main).toContain("__Label_Int_label(four)");
  });

  test("the forwarder and the constraint name carry no `.d.ts` face (§6.5)", () => {
    const project = compileFiles(files);
    const labels = project.modules.find(({ source }) => source.path === "/labels.hex")!;
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;

    // Scoped to what §6.5 claims, which is narrower than it first read: the
    // forwarder and default-helper ESM exports are plumbing with no face of
    // their own. The *public* face of an exported constraint is FFI Part 9's
    // public-evidence closure, owned there and neither added to nor subtracted
    // from here — so this must not be read as "an exported constraint never
    // reaches a `.d.ts`". In particular `/labels.hex` is NOT asserted free of
    // the member's name: `Label` is public and `Label<Int>` satisfies Part 9
    // §5's closure, so the owed (unbuilt) surface there — `Label.Dictionary`,
    // the `Label<Int>` handle — would lawfully carry it.
    for (const text of [labels.declarations.text, main.declarations.text]) {
      expect(text).not.toContain("__label");
      expect(text).not.toContain("__default");
    }
    // `/main.hex` declares only the private `Room`, so Part 9's closure fires
    // for nothing here: neither the member name nor the constraint may appear.
    // The constraint name binds in neither namespace a face is built from, so
    // it cannot become an `import type` row either.
    expect(main.declarations.text).not.toContain("label");
    expect(main.declarations.text).not.toContain("Label");
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

  // #762 retired the named import that used to name `Whisper`/`whisper`
  // directly; the route left is the module alias's dot, and the "does not
  // export" report is the same one Modules §3.3's qualifier already owns for
  // any name a module does not hand out — a private constraint's name and its
  // member alike.
  test("its name is not an export", () => {
    expect(messagesOf([
      ["/quiet.hex", "module Quiet\n\n" + home],
      ["/main.hex", "module Main\n\n" + [
        'import Quiet',
        "",
        "export fun go<a: Quiet.Whisper>(x: a): Int = 1",
        "",
      ].join("\n")],
    ])).toEqual(["unknown constraint `Quiet.Whisper`"]);
  });

  test("neither is a member of it", () => {
    expect(messagesOf([
      ["/quiet.hex", "module Quiet\n\n" + home],
      ["/main.hex", "module Main\n\n" + [
        'import Quiet',
        "",
        "export let go: Int = Quiet.whisper(1)",
        "",
      ].join("\n")],
    ])).toEqual(["module `Quiet` does not export `whisper`"]);
  });

  test("its emission is unchanged by the feature", () => {
    // The byte-for-byte guard on §6.5's "for an unexported constraint nothing
    // changes": no forwarder export, no hoisted helper, the default copied into
    // the honoring dictionary as before.
    const text = emitted([["/main.hex", "module Main\n\n" + [
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

    expect(text).not.toContain("__default");
    expect(text).not.toContain("__greet");
    expect(text).toContain("greetLoudly: ");
  });
});

/**
 * A two-level constraint hierarchy in one module, both levels exported. `Loud`
 * extends `Describe`, so a `Loud` dictionary carries the `Describe` one in its
 * `Describe`-named slot (Constraints §6.2) and a function constrained `<a: Loud>`
 * reaches `describe` as `dict.Describe.describe`.
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
    ["/units.hex", "module Units\n\n" + hierarchy],
    ["/main.hex", "module Main\n\n" + [
      "import Units",
      "",
      "export fun banner<a: Units.Loud>(subject: a): String =",
      "    Units.shout(subject) ++ \" (\" ++ Units.describe(subject) ++ \")\"",
      "",
      "export fun run(): String = banner(Units.Metre({span = 5}))",
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
      /describe\(subject, __Loud_a\.Describe\)/u,
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
      ["/units.hex", "module Units\n\n" + hierarchy],
      ["/middle.hex", "module Middle\n\n" + [
        "import Units",
        "",
        "export fun banner<a: Units.Loud>(subject: a): String =",
        "    Units.shout(subject) ++ \" (\" ++ Units.describe(subject) ++ \")\"",
        "",
        "export fun oneMetre(): Units.Metre = Units.Metre({span = 1})",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Middle",
        "",
        "export fun run(): String = Middle.banner(Middle.oneMetre())",
        "",
      ].join("\n")],
    ]);

    expect((exports.run as () => string)()).toBe("1m (1m)");
  });

  test("the base is the declaration's, even where the importer's word for it is another constraint", async () => {
    // `/middle.hex` declares its own `Describe`, unrelated to `/units.hex`'s.
    // Accepting `tell`'s requirement under the `<a: Loud>` binder means walking
    // `Loud`'s bases, and the base is a name in *units'* scope: re-deriving it
    // here lands on middle's own declaration and the binder is refused for a
    // program that is well typed. This is the case `baseConstraintIdentities`
    // exists for, and the only one where the two answers differ.
    const exports = await runProject([
      ["/units.hex", "module Units\n\n" + [
        hierarchy,
        "export fun tell<a: Describe>(subject: a): String = describe(subject)",
        "",
      ].join("\n")],
      ["/middle.hex", "module Middle\n\n" + [
        "import Units",
        "",
        "constraint Describe<a> =",
        "    narrate(subject: a): String",
        "",
        "record Note = {body: String}",
        "",
        "honor Describe<Note> =",
        "    narrate(n) = \"note\"",
        "",
        "export fun banner<a: Units.Loud>(subject: a): String = Units.tell(subject)",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Middle",
        "import Units",
        "",
        "export fun run(): String = Middle.banner(Units.Metre({span = 2}))",
        "",
      ].join("\n")],
    ]);

    expect((exports.run as () => string)()).toBe("2m");
  });

  test("a local constraint of the same name does not answer the imported one", () => {
    // §5.1.1 across the export boundary: `main`'s own `Loud` is a different
    // declaration, so the imported `banner`'s requirement is not satisfied by
    // the local instance and the local `blare` is not `Loud`'s member.
    expect(messagesOf([
      ["/units.hex", "module Units\n\n" + hierarchy],
      ["/middle.hex", "module Middle\n\n" + [
        "import Units",
        "",
        "export fun banner<a: Units.Loud>(subject: a): String = Units.shout(subject)",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Middle",
        "",
        "record Siren = {pitch: Int}",
        "",
        "constraint Loud<a> =",
        "    blare(subject: a): String",
        "",
        "honor Loud<Siren> =",
        "    blare(s) = \"weeee\"",
        "",
        "export fun run(): String = Middle.banner(Siren({pitch = 3}))",
        "",
      ].join("\n")],
    ])).toEqual([
      // §7.6's **ordinary** clause, not its sealed one: `Loud` is exported, so
      // `main` is one `import Units` away from writing the honor
      // as `honor Units.Loud<Siren>`, and its own file is the home the report
      // leads with. (`./units.hex` could not hold it — naming `Siren` there
      // would need an import of `./main.hex`, which §7.3 forbids on this graph.)
      "type `Siren` has no `Loud` instance; it could only be declared in `./main.hex` " +
        "(declares `Siren`) or `./units.hex` (declares `Loud`)",
    ]);
  });
});

/**
 * A three-link chain whose **middle** link is private: `Tiny <- Small <- Big`,
 * with only `Big` exported.
 *
 * Legal, and §6.5 says why: "subject, base constraints, member schemes,
 * defaults, and implied type members do not travel separately — they are the
 * declaration, and every importing module sees the one declaration the home
 * module made." There is no private-in-public rule for constraints (Modules
 * §4.3 governs *types* in exported term signatures), so a base constraint
 * crosses whether or not the importer could ever spell it.
 */
const chain = [
  "constraint Tiny<a> =",
  "    tiny(subject: a): String",
  "",
  "constraint Small<a: Tiny> =",
  "    small(subject: a): String",
  "",
  "export constraint Big<a: Small> =",
  "    big(subject: a): String",
  "",
  "export record Gram = {mass: Int}",
  "",
  "honor Tiny<Gram> =",
  "    tiny(g) = \"tiny\"",
  "",
  "honor Small<Gram> =",
  "    small(g) = \"small\"",
  "",
  "honor Big<Gram> =",
  "    big(g) = \"big\"",
  "",
  "export fun weigh<a: Tiny>(subject: a): String = tiny(subject)",
  "",
  "export fun oneGram(): Gram = Gram({mass = 1})",
  "",
].join("\n");

describe("a base chain whose middle link the importer cannot name", () => {
  const files = [
    ["/scales.hex", "module Scales\n\n" + chain],
    ["/main.hex", "module Main\n\n" + [
      "import Scales",
      "",
      "export fun report<a: Scales.Big>(subject: a): String =",
      "    Scales.big(subject) ++ \"/\" ++ Scales.weigh(subject)",
      "",
      "export fun run(): String = report(Scales.oneGram())",
      "",
    ].join("\n")],
  ] as const;

  test("the two-hop slot path is built through the private middle link", () => {
    // This is what the transitive metadata channel exists for, and the *only*
    // shape that needs it. A directly imported extending constraint carries its
    // bases' identities on `baseConstraintIdentities`, which is enough to take
    // one hop — `Big` to `Small` — with no declaration of `Small` at all. The
    // second hop is where a declaration is unavoidable: reaching `Tiny` means
    // reading `Small`'s own bases, and `Small` is private to `./scales`, so no
    // import of this module can ever have named it.
    expect(emitted(files, "/main.hex")).toMatch(
      /weigh\(subject, __Big_a\.Small\.Tiny\)/u,
    );
  });

  test("and the program compiles and runs", async () => {
    // Without the channel the checker instead demands `<a: (Big, Tiny)>` — a
    // rewrite this module cannot perform, since neither `Small` nor `Tiny` is
    // nameable here — and emission passes `undefined` for the evidence. The
    // execution is the half that shows the path is the right one and not merely
    // a path.
    const exports = await runProject(files);

    expect((exports.run as () => string)()).toBe("big/tiny");
  });

  test("the base obligation is still checked when the base is unnameable", () => {
    // The consequence of the shape above, recorded rather than assumed: an
    // exported constraint with a private base can only be honored where that
    // base can be honored too, which is its own module. §4.2's obligation is
    // checked here — it is not skipped for want of a name.
    expect(messagesOf([
      ["/scales.hex", "module Scales\n\n" + chain],
      ["/main.hex", "module Main\n\n" + [
        "import Scales",
        "",
        "record Ounce = {drams: Int}",
        "",
        "honor Scales.Big<Ounce> =",
        "    big(o) = \"ounce\"",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Ounce` has no `Small` instance; `Small` is not nameable here, so the honor " +
        "can only be written in `./scales.hex`, which declares it",
    ]);
  });
});

describe("the orphan rule reads files, never imports (Constraints §5.3)", () => {
  test("`honor ImportedC<LocalT>` is lawful — the subject's home is this file", () => {
    expect(messagesOf([
      ["/units.hex", "module Units\n\n" + hierarchy],
      ["/main.hex", "module Main\n\n" + [
        "import Units",
        "",
        "record Furlong = {chains: Int}",
        "",
        "honor Units.Describe<Furlong> =",
        "    describe(f) = \"${f.chains} chains\"",
        "",
        "export fun run(): String = Units.describe(Furlong({chains = 8}))",
        "",
      ].join("\n")],
    ])).toEqual([]);
  });

  test("`honor ImportedC<ImportedT>` in a third module is the §5.3 error", () => {
    // Visible is not the same as owned. Both homes are elsewhere, so this module
    // has no claim on the pair however many of its names it can spell.
    expect(messagesOf([
      ["/units.hex", "module Units\n\n" + hierarchy],
      ["/rods.hex", "module Rods\n\n" + [
        "export record Rod = {poles: Int}",
        "",
        "export fun oneRod(): Rod = Rod({poles = 1})",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Units",
        "import Rods",
        "",
        "honor Units.Describe<Rods.Rod> =",
        "    describe(r) = \"a rod\"",
        "",
        "export fun run(): Int = 0",
        "",
      ].join("\n")],
    ])).toEqual([
      "orphan instance: this module declares neither `Units.Describe` nor the instance subject",
    ]);
  });

  test("an importer does not re-report the home module's base-constraint faults", () => {
    // `#checkBaseConstraintGraph` is the home module's business. Its one report
    // must appear once, at the declaration, not once per importer.
    const messages = messagesOf([
      ["/broken.hex", "module Broken\n\n" + [
        "export constraint Ring<a: Chain> =",
        "    ring(subject: a): Int",
        "",
        "export constraint Chain<a: Ring> =",
        "    chain(subject: a): Int",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Broken",
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
    "fun decorate(text: String): String = \"<< \" ++ text ++ \" >>\"",
    "",
    "export constraint Stamp<a> =",
    "    mark(subject: a): String",
    "    stamped(subject: a): String = decorate(mark(subject))",
    "",
    "export record Seal = {sigil: String}",
    "",
    "honor Stamp<Seal> =",
    "    mark(s) = s.sigil",
    "",
  ].join("\n");

  const files = [
    ["/stamps.hex", "module Stamps\n\n" + stamps],
    ["/main.hex", "module Main\n\n" + [
      "import Stamps",
      "",
      "record Ticket = {serial: String}",
      "",
      "honor Stamps.Stamp<Ticket> =",
      "    mark(t) = \"no. \" ++ t.serial",
      "",
      "export fun homeSide(): String = Stamps.stamped(Stamps.Seal({sigil = \"wax\"}))",
      "export fun awaySide(): String = Stamps.stamped(Ticket({serial = \"117\"}))",
      "",
    ].join("\n")],
  ] as const;

  test("the body emits once, in the module that wrote it", () => {
    const home = emitted(files, "/stamps.hex");

    expect(home).toContain("const __default_stamped = ");
    expect(home).toContain("export { __default_stamped };");
    // One call to the private helper, not one copy of the body per honoring
    // instance — and the sibling member reached through the dictionary the
    // helper was handed, so an override would win (§2, §6.3).
    expect(home).toContain(
      "const __default_stamped = (__dict, subject) => decorate(mark(subject, __dict));",
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
      /import \{[^}]*__default_stamped[^}]*\} from "\.\/stamps\.js";/u,
    );
    // Deferred, never eager: the dictionary const is not initialized while its
    // own literal is under construction (§6.3). The wrapper is the inherited
    // default's *seat* since #444 — it is a member of the instance's completed
    // set like any other, and closes over the helper and this module's own
    // dictionary exactly as §6.1 states.
    expect(away).toContain(
      "const __Stamp_Ticket_stamped = __arg0 => __default_stamped(__Stamp_Ticket, __arg0);",
    );
    expect(away).toContain("stamped: __Stamp_Ticket_stamped");
  });

  test("a default calling a sibling member dispatches through the completed instance", async () => {
    // §2's rule, unchanged by hoisting: the override must win, and it can only
    // win if the default reads the slot off the dictionary at call time.
    const exports = await runProject([
      ["/chimes.hex", "module Chimes\n\n" + [
        "export constraint Chime<a> =",
        "    note(subject: a): String",
        "    peal(subject: a): String = note(subject) ++ note(subject)",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Chimes",
        "",
        "record Bell = {tone: String}",
        "record Gong = {tone: String}",
        "",
        "honor Chimes.Chime<Bell> =",
        "    note(b) = b.tone",
        "",
        "honor Chimes.Chime<Gong> =",
        "    note(g) = g.tone",
        "    peal(g) = \"BONG\"",
        "",
        "export fun inherited(): String = Chimes.peal(Bell({tone = \"ding\"}))",
        "export fun overridden(): String = Chimes.peal(Gong({tone = \"low\"}))",
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
      ["/renders.hex", "module Renders\n\n" + [
        "export constraint Render<a> =",
        "    render(subject: a): String",
        "",
        "honor Render<Int> =",
        "    render(n) = \"${n}\"",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Renders",
        "",
        "union Nest(a) = Leaf(value: a) | Wrap(inner: Nest(a))",
        "",
        "honor<a: Renders.Render> Renders.Render<Nest(a)> =",
        "    render(n) =",
        "        match n",
        // The sanctioned recursion spelling since #304/#335: a member cannot
        // call its own name (Constraints §4.6), and the dot call is the route
        // — `inner: Nest(a)` dispatches through this instance's own evidence,
        // `value: a` through the binder's (Method Syntax §3.4's bounds row).
        "            Leaf(value) => value.render()",
        "            Wrap(inner) => \"(\" ++ inner.render() ++ \")\"",
        "",
        "let three: Int = 3",
        "export fun run(): String = Renders.render(Wrap(Wrap(Leaf(three))))",
        "",
      ].join("\n")],
    ]);

    expect((exports.run as () => string)()).toBe("((3))");
  });
});

describe("aliased and namespace imports (Modules §3.2, §3.3)", () => {
  // #762 retired the named import's own `as` — a module alias is the one
  // rename left, and it substitutes for the *module's* word at every use
  // (`Heft.Weigh`, `Heft.grams`); the member's own spelling is untouched
  // either way, which is what these two still measure.
  test("an alias renames the module only; members keep their names", async () => {
    const exports = await runProject([
      ["/weights.hex", "module Weights\n\n" + [
        "export constraint Weigh<a> =",
        "    grams(subject: a): Int",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Weights as Heft",
        "",
        "record Brick = {count: Int}",
        "",
        "honor Heft.Weigh<Brick> =",
        "    grams(b) = b.count",
        "",
        "export fun total<a: Heft.Weigh>(subject: a): Int = Heft.grams(subject)",
        "export fun run(): Int = total(Brick({count = 900}))",
        "",
      ].join("\n")],
    ]).then((exports) => exports);

    expect((exports.run as () => number)()).toBe(900);
  });

  test("an alias round-trips through a second export", async () => {
    const exports = await runProject([
      ["/weights.hex", "module Weights\n\n" + [
        "export constraint Weigh<a> =",
        "    grams(subject: a): Int",
        "",
        "export record Anvil = {mass: Int}",
        "",
        "honor Weigh<Anvil> =",
        "    grams(a) = a.mass",
        "",
      ].join("\n")],
      ["/middle.hex", "module Middle\n\n" + [
        "import Weights as Heft",
        "",
        "export fun weighed<a: Heft.Weigh>(subject: a): Int = Heft.grams(subject)",
        "export fun anvil(): Heft.Anvil = Heft.Anvil({mass = 40})",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Middle",
        "",
        "export fun run(): Int = Middle.weighed(Middle.anvil())",
        "",
      ].join("\n")],
    ]);

    expect((exports.run as () => number)()).toBe(40);
  });

  test("a namespace-imported constraint may be honored for a local type", async () => {
    // The only spelling available to a module that reached the constraint this
    // way, and its own type is a lawful home for the instance (§5.3).
    const exports = await runProject([
      ["/geo.hex", "module Geo\n\n" + [
        "export constraint Perimeter<a> =",
        "    around(subject: a): Int",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Geo",
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

  test("a qualified binder reads the aliased module's *exported* constraint namespace", () => {
    // Modules §5.1 rule 2's constraint analog. An unexported constraint is not
    // in that namespace, so `Geo.Hidden` names nothing — the same answer a
    // module gets for any constraint it cannot see.
    expect(messagesOf([
      ["/atlas.hex", "module Atlas\n\n" + [
        "constraint Hidden<a> =",
        "    trace(subject: a): String",
        "",
        "export constraint Plotted<a> =",
        "    plot(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Atlas",
        "",
        "export fun draw<a: Atlas.Hidden>(subject: a): String = \"x\"",
        "",
      ].join("\n")],
    ])).toContain("unknown constraint `Atlas.Hidden`");
  });

  test("a namespace import qualifies the constraint in a binder and its member as a term", async () => {
    const exports = await runProject([
      ["/geo.hex", "module Geo\n\n" + [
        "export constraint Area<a> =",
        "    area(subject: a): Int",
        "",
        "export record Square = {side: Int}",
        "",
        "honor Area<Square> =",
        "    area(s) = s.side * s.side",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        "import Geo",
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
    ["/streams.hex", "module Streams\n\n" + [
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
    ["/main.hex", "module Main\n\n" + [
      "import Streams",
      "",
      "export fun first(): String = Streams.peek(Streams.Ledger({entries = []}))",
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
      ["/main.hex", "module Main\n\n" + [
        "import Streams",
        "",
        "record Register = {rows: Int}",
        "",
        "honor Streams.Source<Register> =",
        "    type Item = Int",
        "    peek(r) = r.rows",
        "",
        "export fun rows(): Int = Streams.peek(Register({rows = 9}))",
        "",
      ].join("\n")],
    ]);

    expect((exports.rows as () => number)()).toBe(9);
  });

  test("and a wrongly typed use is caught against it", () => {
    expect(messagesOf([
      files[0],
      ["/main.hex", "module Main\n\n" + [
        "import Streams",
        "",
        "export fun first(): Int = Streams.peek(Streams.Ledger({entries = []}))",
        "",
      ].join("\n")],
    ])).toContain("type mismatch: expected Int, found String");
  });
});

/**
 * Both describe blocks that used to stand here — "collisions (Modules §5.2)"
 * and "members cannot be imported severally (Modules §3.1, §12.4)" — pinned
 * consequences of one mechanism #762 deleted outright: a named import used to
 * put a constraint *and its members* bare in the importer's own scope, which
 * is exactly what made an import able to collide with a local declaration,
 * with another import, or on a member name, and what made naming a bare
 * member in an import list refusable with "import the constraint instead".
 *
 * An import binds a module and nothing smaller now (Modules §3.2), so none of
 * that is reachable any more:
 *
 * - A local declaration answers a bare constraint name outright, with no
 *   second meaning for a collision rule to find (the companion-fallback
 *   arc's own reading, `companion-fallback.test.ts`'s "occlusion" suite).
 * - Two module aliases never collide on a *constraint's* name, because
 *   neither import binds one — they collide only if the two `import`
 *   statements are given the same alias, which is a module-alias fact with
 *   no constraint content, and belongs to the general import conformance
 *   suite rather than here.
 * - A member never arrives in bare scope at all, from one import or two, so
 *   there is no member-vs-member, member-vs-prelude, or member-vs-local-term
 *   collision left to have — and no bare member name to import severally
 *   either, since `import { magnitude } from "./sizes"` is now the #762
 *   parse error regardless of whether `magnitude` is a member of anything.
 *
 * Every specimen these blocks held is therefore removed rather than re-aimed:
 * the property under test — an import binding a bare name that then collides
 * — has no seat left to hold anywhere in the language.
 */

describe("`export honor` and `opaque constraint` (Modules §4.1, §10)", () => {
  test("`export honor` names the rule rather than the grammar", () => {
    expect(messagesOf([["/main.hex", "module Main\n\n" + [
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

  test("`opaque constraint` names where `opaque` applies", () => {
    expect(messagesOf([["/main.hex", "module Main\n\n" + [
      "opaque constraint Hidden<a> =",
      "    peek(subject: a): Int",
      "",
    ].join("\n")]])).toContain(
      "`opaque` applies to `record` and `union` declarations",
    );
  });
});

/**
 * The three internal-name families are spelled from the *source* name since
 * #430 — `__default_log` for a defaulted member's hoisted helper, `__log` for a
 * member's forwarder, `__log` for a constrained term's export — and they share
 * one ESM namespace, so where two prefer one spelling, one gives way. Both
 * sides of a module boundary must give way the same way, and the importer
 * cannot see the contest: `import { default_log }` names the term and never the
 * constraint whose member `log` claims the spelling. So the inputs travel on
 * the import item and one rule reads them at both ends (Lexer §3.2's probe,
 * from 1).
 *
 * Every case here is compiled *and executed*, because the failure is a clean
 * compile emitting JavaScript that will not load: a duplicate ESM export is a
 * `SyntaxError`, and only running the program sees it. The fixtures are
 * deliberately unalike — two conformance modules with byte-identical output
 * share one `data:` module instance in the test linker.
 */
describe("internal names that contest one spelling (#430)", () => {
  const files = [
    ["/ledger.hex", "module Ledger\n\n" + [
      "export constraint Tally<a> =",
      "    mark(entry: a): String",
      "    log(entry: a): String = mark(entry) ++ \" (logged)\"",
      "",
      "export let default_log<a: Tally>(entry: a): String = \"[\" ++ mark(entry) ++ \"]\"",
      "",
      "export record Coin = {face: String}",
      "",
      "honor Tally<Coin> =",
      "    mark(c) = c.face",
      "",
    ].join("\n")],
    ["/tills.hex", "module Tills\n\n" + [
      "import Ledger",
      "",
      "record Note = {body: String}",
      "",
      "honor Ledger.Tally<Note> =",
      "    mark(n) = n.body",
      "",
      "export fun bracketed(): String = Ledger.default_log(Ledger.Coin({face = \"gold\"}))",
      "export fun logged(): String = Ledger.log(Note({body = \"memo\"}))",
      "",
    ].join("\n")],
  ] as const;

  test("the default helper keeps the bare spelling and the term probes past it", () => {
    const home = emitted(files, "/ledger.hex");

    // The helper is unconditional, and that is what makes it predictable: an
    // importer reaches it through the constraint declaration alone and can see
    // nothing of this module's terms.
    expect(home).toContain("const __default_log = ");
    expect(home).toContain("export { __default_log };");
    // `default_log` is an ordinary term name, and its constrained export wants
    // the same spelling. It takes the first free suffix instead.
    expect(home).toContain("export { default_log as __default_log_1 };");
  });

  test("the importer of both reaches the same two names", () => {
    const away = emitted(files, "/tills.hex");

    // The call site now spells the term `Ledger.default_log`, so the local
    // JavaScript binding no longer has to keep the bare source name alive —
    // it imports under a name of the emitter's own choosing, and that name
    // is still the one the home module gave the resolved suffix.
    expect(away).toContain('import { __default_log_1 as __default_log } from "./ledger.js";');
  });

  test("and the emitted program loads and runs", async () => {
    const exports = await runProject(files, { entry: "/tills.hex" });

    expect((exports.bracketed as () => string)()).toBe("[gold]");
    expect((exports.logged as () => string)()).toBe("memo (logged)");
  });

  /**
   * A probe is not free to land where it likes: the spelling it settles on may
   * be some *other* name's preferred one. `default_log` pushed off
   * `__default_log` would land on `__default_log_1`, which is exactly what the
   * term `default_log_1` wants — so the term family probes past its own
   * siblings' preferred spellings as well as the helpers, and goes on to
   * `__default_log_2`.
   */
  test("a term pushed off its spelling does not land on another term's", async () => {
    const twins = [
      ["/tolls.hex", "module Tolls\n\n" + [
        "export constraint Fare<a> =",
        "    price(entry: a): Int",
        "    log(entry: a): Int = price(entry) + 1",
        "",
        "export let default_log<a: Fare>(entry: a): Int = price(entry) * 10",
        "export let default_log_1<a: Fare>(entry: a): Int = price(entry) * 100",
        "",
        "export record Token = {worth: Int}",
        "",
        "honor Fare<Token> =",
        "    price(t) = t.worth",
        "",
      ].join("\n")],
      ["/gates.hex", "module Gates\n\n" + [
        "import Tolls",
        "",
        "export fun tenfold(): Int = Tolls.default_log(Tolls.Token({worth = 3}))",
        "export fun hundredfold(): Int = Tolls.default_log_1(Tolls.Token({worth = 3}))",
        "",
      ].join("\n")],
    ] as const;
    const home = emitted(twins, "/tolls.hex");

    expect(home).toContain("export { __default_log };");
    expect(home).toContain("export { default_log_1 as __default_log_1 };");
    expect(home).toContain("export { default_log as __default_log_2 };");

    // The call sites now spell the terms `Tolls.default_log`/`Tolls.default_log_1`,
    // so the local JavaScript bindings import under names of the emitter's own
    // choosing rather than keeping the bare source spelling alive.
    const away = emitted(twins, "/gates.hex");
    expect(away).toContain(
      'import { __default_log_2 as __default_log, __default_log_1 } from "./tolls.js";',
    );

    const exports = await runProject(twins, { entry: "/gates.hex" });
    expect((exports.tenfold as () => number)()).toBe(30);
    expect((exports.hundredfold as () => number)()).toBe(300);
  });

  /**
   * The contest inside one declaration: a member named `default_log` beside a
   * defaulted member named `log`. The forwarder family gives way to the helper
   * family for the same reason the term family does — the helper is the one
   * spelling an importer can reach with no further information.
   */
  test("a member forwarder gives way to a sibling's default helper", async () => {
    const marks = [
      ["/marks.hex", "module Marks\n\n" + [
        "export constraint Stamp<a> =",
        "    mark(entry: a): String",
        "    log(entry: a): String = mark(entry) ++ \" (logged)\"",
        "    default_log(entry: a): String",
        "",
        "export record Slip = {tag: String}",
        "",
        "honor Stamp<Slip> =",
        "    mark(s) = s.tag",
        "    default_log(s) = \"<\" ++ s.tag ++ \">\"",
        "",
      ].join("\n")],
      ["/desks.hex", "module Desks\n\n" + [
        "import Marks",
        "",
        "export fun angled(): String = Marks.default_log(Marks.Slip({tag = \"blue\"}))",
        "export fun noted(): String = Marks.log(Marks.Slip({tag = \"blue\"}))",
        // The polymorphic pair, which is what still binds the forwarders since
        // #444 — the two calls above are concrete and reach seats.
        "export fun angledAny<a: Marks.Stamp>(x: a): String = Marks.default_log(x)",
        "export fun notedAny<a: Marks.Stamp>(x: a): String = Marks.log(x)",
        "",
      ].join("\n")],
    ] as const;
    const home = emitted(marks, "/marks.hex");

    expect(home).toContain("export { __default_log };");
    expect(home).toContain("export { default_log as __default_log_1 };");

    const away = emitted(marks, "/desks.hex");
    // The two concrete calls reach the instance's own seats under the source
    // names, borrowed straight off the honoring dictionary — no probe needed
    // there. The polymorphic pair still needs the forwarders, and it is their
    // import that carries the resolved suffix.
    expect(away).toContain(
      'import { __Stamp_Slip_default_log as default_log, __Stamp_Slip_log as log } from "./marks.js";',
    );
    expect(away).toContain('import { __log, __default_log_1 as __default_log } from "./marks.js";');

    const exports = await runProject(marks, { entry: "/desks.hex" });
    expect((exports.angled as () => string)()).toBe("<blue>");
    expect((exports.noted as () => string)()).toBe("blue (logged)");
  });

  /**
   * Both ranks at once, which is why the term family probes past the *resolved*
   * forwarders and not merely the preferred ones: the term `default_log` is
   * pushed off the helper's `__default_log`, and the spelling it would take
   * next is where member `default_log_1`'s forwarder already sits.
   */
  test("a term probes past a forwarder as well as a helper", async () => {
    const tags = [
      ["/tags.hex", "module Tags\n\n" + [
        "export constraint Note<a> =",
        "    body(entry: a): String",
        "    log(entry: a): String = body(entry) ++ \"!\"",
        "    default_log_1(entry: a): String",
        "",
        "export let default_log<a: Note>(entry: a): String = \"[\" ++ body(entry) ++ \"]\"",
        "",
        "export record Card = {word: String}",
        "",
        "honor Note<Card> =",
        "    body(c) = c.word",
        "    default_log_1(c) = \"{\" ++ c.word ++ \"}\"",
        "",
      ].join("\n")],
      ["/racks.hex", "module Racks\n\n" + [
        "import Tags",
        "",
        "export fun squared(): String = Tags.default_log(Tags.Card({word = \"red\"}))",
        "export fun braced(): String = Tags.default_log_1(Tags.Card({word = \"red\"}))",
        "export fun banged(): String = Tags.log(Tags.Card({word = \"red\"}))",
        "export fun bracedAny<a: Tags.Note>(x: a): String = Tags.default_log_1(x)",
        "",
      ].join("\n")],
    ] as const;
    const home = emitted(tags, "/tags.hex");

    expect(home).toContain("export { __default_log };");
    expect(home).toContain("export { default_log_1 as __default_log_1 };");
    expect(home).toContain("export { default_log as __default_log_2 };");

    const away = emitted(tags, "/racks.hex");
    // `braced`/`banged` are concrete and reach the instance's own seats
    // directly; `squared` and `bracedAny` are the ones that still need
    // forwarders, and their imports carry the resolved suffixes.
    expect(away).toContain(
      'import { __Note_Card_default_log_1 as default_log_1, __Note_Card_log as log } from "./tags.js";',
    );
    expect(away).toContain('import { __default_log_1 } from "./tags.js";');
    expect(away).toContain('import { __default_log_2 as __default_log } from "./tags.js";');

    const exports = await runProject(tags, { entry: "/racks.hex" });
    expect((exports.squared as () => string)()).toBe("[red]");
    expect((exports.braced as () => string)()).toBe("{red}");
    expect((exports.banged as () => string)()).toBe("red!");
  });

  /**
   * The invariant rather than a spelling, over a cluster deep enough that every
   * rank pushes on the next: four members (one defaulted) and two terms, all
   * preferring some `__default_log…`. A duplicate ESM export name is a
   * `SyntaxError` at load after a clean compile, which is the failure the whole
   * ranking exists to prevent — so this reads the export names as a set and
   * asks nothing about which name got which.
   */
  test("no module exports one internal spelling twice, however deep the probe", async () => {
    const dense = [["/tiers.hex", "module Tiers\n\n" + [
      "export constraint Rung<a> =",
      "    height(entry: a): Int",
      "    log(entry: a): Int = height(entry) + 1",
      "    default_log_1(entry: a): Int",
      "    default_log_2(entry: a): Int",
      "",
      "export let default_log<a: Rung>(entry: a): Int = height(entry) * 2",
      "export let default_log_3<a: Rung>(entry: a): Int = height(entry) * 3",
      "",
      "export record Step = {rise: Int}",
      "",
      "honor Rung<Step> =",
      "    height(s) = s.rise",
      "    default_log_1(s) = s.rise + 10",
      "    default_log_2(s) = s.rise + 20",
      "",
      "export let doubled: Int = default_log(Step({rise = 5}))",
      "export let tripled: Int = default_log_3(Step({rise = 5}))",
      "export let raised: Int = log(Step({rise = 5}))",
      "",
    ].join("\n")]] as const;
    const text = emitted(dense, "/tiers.hex");

    // The exported name is what follows `as`, or the bare name where there is
    // no alias.
    const exported = [...text.matchAll(/^export \{ (?:\w+ as )?(\w+) \};$/gmu)]
      .map(([, name]) => name);
    expect(exported.length).toBeGreaterThan(0);
    expect(new Set(exported).size).toBe(exported.length);

    const exports = await runProject(dense, { entry: "/tiers.hex" });
    expect(exports.doubled).toBe(10);
    expect(exports.tripled).toBe(15);
    expect(exports.raised).toBe(6);
  });

  /**
   * The other contest, which is the importer's own: two modules declaring a
   * member of one name export forwarders of one spelling, and this module binds
   * both. The exported spellings are untouched — a name that moved with its
   * consumers would stop being predictable — so the *local* is aliased, the way
   * a contested dictionary local is (Dictionary Sharing §5).
   */
  test("two modules' forwarders for one member name bind under distinct locals", async () => {
    const rivals = [
      ["/loudly.hex", "module Loudly\n\n" + [
        "export constraint Loud<a> =",
        "    pitch(value: a): Int",
        "",
      ].join("\n")],
      ["/softly.hex", "module Softly\n\n" + [
        "export constraint Soft<a> =",
        "    pitch(value: a): Int",
        "",
      ].join("\n")],
      ["/organ.hex", "module Organ\n\n" + [
        "import Loudly as Loud",
        "import Softly as Soft",
        "",
        "export record Pipe = {bore: Int}",
        "",
        "honor Loud.Loud<Pipe> =",
        "    pitch(value) = value.bore * 100",
        "",
        "honor Soft.Soft<Pipe> =",
        "    pitch(value) = value.bore",
        "",
        "export let shrill: Int = Loud.pitch(Pipe({bore = 3}))",
        "export let muted: Int = Soft.pitch(Pipe({bore = 3}))",
        "export fun anyLoud<a: Loud.Loud>(x: a): Int = Loud.pitch(x)",
        "export fun anySoft<a: Soft.Soft>(x: a): Int = Soft.pitch(x)",
        "",
      ].join("\n")],
    ] as const;
    const organ = emitted(rivals, "/organ.hex");

    expect(organ).toContain('import { __pitch } from "./loudly.js";');
    expect(organ).toContain('import { __pitch as __pitch_1 } from "./softly.js";');
    // The two concrete calls no longer need either forwarder: each names the
    // instance's own seat, and the seats are already distinct because the
    // dictionary family keys on the constraint (#444).
    expect(organ).toContain("const shrill = __Loud_Pipe_pitch({ bore: 3 });");
    expect(organ).toContain("const muted = __Soft_Pipe_pitch({ bore: 3 });");

    const exports = await runProject(rivals, { entry: "/organ.hex" });
    expect(exports.shrill).toBe(300);
    expect(exports.muted).toBe(3);
  });
});
