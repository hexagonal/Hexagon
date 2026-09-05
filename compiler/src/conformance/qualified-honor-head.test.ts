import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for **the qualified honor head** — `honor D.Describe<Box>`
 * (Constraints §4.1's Head bullet, #567).
 *
 * The form compiled long before it was written down: `#parseConstraintReference`
 * is one shared path for a binder's obligation and an instance head, so the
 * head accepted `Alias.Name` by construction while §4.1's text still stated the
 * bare spelling only. §4.1 now admits it, and defers resolution to Modules §5.1
 * rule 2 — the same sentence every other constraint position defers to. Nothing
 * about the head is special; this file exists so that nothing about the head
 * *becomes* special without a test saying so.
 *
 * The three claims the sentence makes, and this file pins:
 *
 * - **Resolution deferral.** `Alias.Name` in the head resolves in the aliased
 *   module's exported constraint namespace (Modules §3.3), head or no head.
 * - **Identity.** Both spellings name the one declaration, so coherence and
 *   duplicate detection see one instance under either — the ruling's
 *   non-breakage crux against #531's fallback, #546's `widens`, and #565.
 * - **Parameterized parity.** §4.3's heads take the qualified slot identically.
 *
 * What the blessing is *for* is the last suite but one: a module that reached a
 * constraint under a differently-spelled alias, and wants to build a door for
 * it. A named import of the constraint is what #546 refuses beside a `widens`,
 * and realiasing is a rename of every use — so the qualified head is that
 * module's only route, and it is a route with no other pin on it.
 *
 * The **bare** half — a head that reaches its constraint through #531's
 * same-spelled-alias fallback — is pinned by `companion-fallback.test.ts`, and
 * is written here only where a test needs both spellings in one program to say
 * something about identity.
 *
 * Fixtures deliberately differ in their strings and their aliases: two modules
 * that emit byte-identical JavaScript share one ESM `data:` module instance in
 * the test linker, which would quietly make two programs one.
 */

/** Every message the project reported, in order. */
function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** A user constraint, exported, reached only through a module alias. */
const DESCRIBE = [
  "/describe.hex",
  "module Describe\n\n" + "export constraint Describe<a> =\n    describe(value: a): String\n",
] as const;

describe("the ground head, end to end", () => {
  test("a differently-spelled alias, a qualified head, and a qualified binder meet", async () => {
    // Compiling is the smaller half of the claim. The instance has to be the
    // one the binder's requirement discharges against and the one the emitted
    // dictionary carries, so the value is read back: an error node that unified
    // with everything would type this program too.
    const files = [
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + 'import Describe as D\n' +
        "export record Box = {n: Int}\n" +
        "honor D.Describe<Box> =\n    describe(value) = \"box ${value.n}\"\n" +
        "export fun label<a: D.Describe>(x: a): String = D.describe(x)\n" +
        "export let shown: String = label(Box({n = 7}))\n"],
    ] as const;

    expect(messages(files)).toEqual([]);
    expect((await runProject(files))["shown"]).toBe("box 7");
  });

  test("the head's own module is a lawful home, and the instance crosses", async () => {
    // Constraints §5.3 is declaration-keyed — the module that declares `C` or
    // the module that declares `T` — and a qualified head names a declaration
    // this module did not make. Its *subject* is local, so the head is lawful,
    // and a consumer that never sees the alias `H` still gets the instance.
    const files = [
      DESCRIBE,
      ["/home.hex",
        "module Home\n\n" + 'import Describe as H\n' +
        "export record Crate = {n: Int}\n" +
        "honor H.Describe<Crate> =\n    describe(value) = \"crate ${value.n}\"\n" +
        "export fun crate(n: Int): Crate = Crate({n = n})\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Describe as Far\n' +
        'import Home\n' +
        "export let shown: String = Far.describe(Home.crate(5))\n"],
    ] as const;

    expect(messages(files)).toEqual([]);
    expect((await runProject(files))["shown"]).toBe("crate 5");
  });
});

describe("a parameterized head takes the qualified slot identically (§4.3)", () => {
  test("a qualified binder over a qualified head, dispatching through both", async () => {
    // Nested: the outer call selects the `Twin` instance, whose body calls the
    // member again at the element type and so must discharge the binder's own
    // requirement from inside the instance. If the head's constraint and the
    // binder's constraint were two identities, this body would not typecheck.
    const files = [
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + 'import Describe as D\n' +
        "export record Chip = {n: Int}\n" +
        "export record Twin(a) = {fst: a, snd: a}\n" +
        "honor D.Describe<Chip> =\n    describe(value) = \"chip ${value.n}\"\n" +
        "honor<a: D.Describe> D.Describe<Twin(a)> =\n" +
        "    describe(pair) = \"(${D.describe(pair.fst)} & ${D.describe(pair.snd)})\"\n" +
        "export let shown: String = " +
        "D.describe(Twin({fst = Chip({n = 1}), snd = Chip({n = 2})}))\n"],
    ] as const;

    expect(messages(files)).toEqual([]);
    expect((await runProject(files))["shown"]).toBe("(chip 1 & chip 2)");
  });

  test("the mixed spelling: a bare binder through the fallback, a qualified head", async () => {
    // One alias, spelled like the constraint, so the binder may be bare (#531)
    // while the head is qualified — the two spellings of one declaration inside
    // a single `honor` item. Executed, because the failure mode here is not a
    // diagnostic but an instance registered under a key the binder never asks
    // for.
    const files = [
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + 'import Describe\n' +
        "export record Plate = {n: Int}\n" +
        "export record Stack(a) = {top: a, rest: a}\n" +
        "honor Describe.Describe<Plate> =\n    describe(value) = \"plate ${value.n}\"\n" +
        "honor<a: Describe> Describe.Describe<Stack(a)> =\n" +
        "    describe(s) = \"[${Describe.describe(s.top)} / ${Describe.describe(s.rest)}]\"\n" +
        "export let shown: String = " +
        "Describe.describe(Stack({top = Plate({n = 3}), rest = Plate({n = 4})}))\n"],
    ] as const;

    expect(messages(files)).toEqual([]);
    expect((await runProject(files))["shown"]).toBe("[plate 3 / plate 4]");
  });
});

/**
 * A qualified home, a bare-via-fallback consumer: the two spellings meeting
 * across a module boundary. Shared by the compile and the run below, which are
 * two tests over one fixture rather than one test making two claims.
 */
const CONSUMER_BARE = [
  DESCRIBE,
  ["/home.hex",
    "module Home\n\n" + 'import Describe as H\n' +
    "export record Parcel = {n: Int}\n" +
    "honor H.Describe<Parcel> =\n    describe(value) = \"parcel ${value.n}\"\n" +
    "export fun parcel(n: Int): Parcel = Parcel({n = n})\n"],
  ["/main.hex",
    "module Main\n\n" + 'import Describe\n' +
    'import Home\n' +
    "export fun label<a: Describe>(x: a): String = Describe.describe(x)\n" +
    "export let shown: String = label(Home.parcel(9))\n"],
] as const;

describe("one declaration under either spelling", () => {
  test("two aliases over one module, one instance: the ordinary duplicate", () => {
    // The ruling's crux in its smallest form. `Describe` is the same-spelled
    // alias, so the first head reaches the declaration through #531's fallback;
    // `D` is a second alias over the *same* module, so the second head reaches
    // the same declaration qualified. Two spellings, one coherence slot, so
    // exactly one ordinary duplicate — not two coexisting instances, and not a
    // message about a constraint nobody can name.
    expect(messages([
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + 'import Describe\n' +
        'import Describe as D\n' +
        "export record Box = {n: Int}\n" +
        "honor Describe<Box> =\n    describe(value) = \"first\"\n" +
        "honor D.Describe<Box> =\n    describe(value) = \"second\"\n"],
    ])).toEqual(["duplicate instance of `D.Describe<Box>`"]);
  });

  test("— and one duplicate with the spellings the other way round", () => {
    // Order does not change the count, only which head is the incumbent: the
    // message is reported at the second head and echoes *its* written face,
    // which is here the bare one.
    expect(messages([
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + 'import Describe\n' +
        'import Describe as D\n' +
        "export record Box = {n: Int}\n" +
        "honor D.Describe<Box> =\n    describe(value) = \"first\"\n" +
        "honor Describe<Box> =\n    describe(value) = \"second\"\n"],
    ])).toEqual(["duplicate instance of `Describe<Box>`"]);
  });

  test("across modules, a qualified home reports exactly as an all-bare control", () => {
    // The control is compiled here rather than transcribed, and that comparison
    // is the pin: the claim is not "these three messages" but "the same program,
    // with the head spelled the other way, is reported the same". It survives a
    // change to the report itself — to Modules §7.3's both-sites form, say,
    // which the compiler does not emit today (the note at the foot of this file
    // records that gap). The literal list below is the second, weaker assertion:
    // a record of today's text, expected to be edited when §7.3 is met.
    const qualifiedHome = [
      DESCRIBE,
      ["/home.hex",
        "module Home\n\n" + 'import Describe as H\n' +
        "export record Box = {n: Int}\n" +
        "honor H.Describe<Box> =\n    describe(value) = \"home\"\n"],
      ["/other.hex",
        "module Other\n\n" + 'import Describe\n' +
        'import Home\n' +
        "honor Describe<Home.Box> =\n    describe(value) = \"other\"\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Other\n' +
        "export let n: Int = 1\n"],
    ] as const;
    const allBare = [
      DESCRIBE,
      ["/home.hex",
        "module Home\n\n" + 'import Describe\n' +
        "export record Box = {n: Int}\n" +
        "honor Describe<Box> =\n    describe(value) = \"home\"\n"],
      qualifiedHome[2],
      qualifiedHome[3],
    ] as const;

    // The second module honors a constraint it did not declare for a subject it
    // did not declare, so it earns Constraints §5.3's orphan error on its own
    // account; the duplicate is then reported twice, once at that head and once
    // at the importer that reaches both. All three are the control's, in order.
    expect(messages(qualifiedHome)).toEqual(messages(allBare));
    expect(messages(qualifiedHome)).toEqual([
      "orphan instance: this module declares neither `Describe` nor the instance subject",
      "duplicate instance of `Describe<Box>`",
      "duplicate instance of `Describe<Box>`",
    ]);
  });

  test("the reverse direction is the control up to the constraint's echoed face", () => {
    // Same arrangement, spellings swapped: the *home* is bare and the orphan
    // module is qualified. Count, kind and order are the control's exactly —
    // the identity claim — but the message text is not, because every report
    // echoes the written face of the head that collided, and that head now
    // spells the constraint `D.Describe`. Recorded, not blessed: Constraints
    // §5.1.1's diagnostics bullet says a message mentioning one constraint uses
    // the bare name, and the last of these three is reported against
    // `/main.hex`, the module that reaches both instances — which cannot see
    // the alias `D` at all. The substitution below is exactly what makes the
    // two lists equal, so a repair that bares the face turns this pin red at
    // one line, and only there.
    const qualifiedElsewhere = [
      DESCRIBE,
      ["/home.hex",
        "module Home\n\n" + 'import Describe\n' +
        "export record Box = {n: Int}\n" +
        "honor Describe<Box> =\n    describe(value) = \"home\"\n"],
      ["/other.hex",
        "module Other\n\n" + 'import Describe as D\n' +
        'import Home\n' +
        "honor D.Describe<Home.Box> =\n    describe(value) = \"other\"\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Other\n' +
        "export let n: Int = 1\n"],
    ] as const;
    const allBare = [
      DESCRIBE,
      qualifiedElsewhere[1],
      ["/other.hex",
        "module Other\n\n" + 'import Describe\n' +
        'import Home\n' +
        "honor Describe<Home.Box> =\n    describe(value) = \"other\"\n"],
      qualifiedElsewhere[3],
    ] as const;

    expect(messages(qualifiedElsewhere).map((message) =>
      message.replaceAll("`D.Describe", "`Describe")
    )).toEqual(messages(allBare));
    expect(messages(qualifiedElsewhere)).toEqual([
      "orphan instance: this module declares neither `D.Describe` nor the instance subject",
      "duplicate instance of `D.Describe<Box>`",
      "duplicate instance of `D.Describe<Box>`",
    ]);
  });

  test("a qualified home answers a consumer's bare requirement, executed", () => {
    // The positive side of identity, and the one that a name-keyed
    // implementation would fail silently rather than loudly: the subject's home
    // honors under a differently-spelled alias, and a consumer that reaches the
    // constraint through #531's same-spelled fallback discharges against it.
    // Compiled here and executed in the test below, on the same fixture.
    expect(messages(CONSUMER_BARE)).toEqual([]);
  });

  test("— and the dictionary that answers it is the home's", async () => {
    expect((await runProject(CONSUMER_BARE))["shown"]).toBe("parcel 9");
  });
});

describe("the stranded door-builder the blessing preserves", () => {
  // The case that decided the ruling. A module reached `Scale` under a
  // differently-spelled alias and wants to widen its member: #546 refuses a
  // `widens` beside a *named* import of the constraint ("the named import is
  // what must go: reach the constraint through `import …` instead"), and
  // Constraints §4.7 spells the `widens` head's member path with a module alias
  // and nothing else. So the alias must stay, and the honor head beside it can
  // only be qualified. Without §4.1's sentence this module had no lawful
  // spelling at all.
  const SCALE = [
    "/scale.hex",
    "module Scale\n\n" + "export constraint Scale<a> =\n    scale(value: a, factor: Int): a\n",
  ] as const;

  test("widens, `= widened`, and a qualified head, end to end", async () => {
    const files = [
      SCALE,
      ["/main.hex",
        "module Main\n\n" + 'import Scale as D\n' +
        "export record Matrix = {n: Float}\n" +
        "widens D.scale(value: Matrix, factor: Float): Matrix = " +
        "Matrix({n = value.n * factor})\n" +
        "honor D.Scale<Matrix> =\n    scale = widened\n" +
        "export fun grow<a: D.Scale>(value: a): a = D.scale(value, 4)\n" +
        "export let grown: Float = grow(Matrix({n = 2.5})).n\n"],
    ] as const;

    // The instance member is the derived restriction of the widened body
    // (#546), so running it proves three things at once: the qualified head
    // registered an instance, `scale = widened` found the `widens` declaration
    // through the same alias, and the restriction is the body that runs.
    expect(messages(files)).toEqual([]);
    expect((await runProject(files))["grown"]).toBe(10);
  });

  test("the qualified spelling changes nothing about which route reaches the door", () => {
    // The wider signature — a `Float` factor — is *not* reachable through the
    // module alias today; the alias's `scale` is the constraint member's
    // restriction, and the call is refused at the argument. That is not this
    // ruling's business: the same program with a same-spelled alias and a bare
    // head is refused identically. Compared against the control rather than
    // against a written message, so if the widened route's reach is later
    // repaired, this pin moves with it instead of freezing a refusal.
    const qualified = messages([
      SCALE,
      ["/main.hex",
        "module Main\n\n" + 'import Scale as D\n' +
        "export record Matrix = {n: Float}\n" +
        "widens D.scale(value: Matrix, factor: Float): Matrix = " +
        "Matrix({n = value.n * factor})\n" +
        "honor D.Scale<Matrix> =\n    scale = widened\n" +
        "export let direct: Float = D.scale(Matrix({n = 1.5}), 2.5).n\n"],
    ]);
    const bare = messages([
      SCALE,
      ["/main.hex",
        "module Main\n\n" + 'import Scale\n' +
        "export record Matrix = {n: Float}\n" +
        "widens Scale.scale(value: Matrix, factor: Float): Matrix = " +
        "Matrix({n = value.n * factor})\n" +
        "honor Scale<Matrix> =\n    scale = widened\n" +
        "export let direct: Float = Scale.scale(Matrix({n = 1.5}), 2.5).n\n"],
    ]);

    expect(qualified).toEqual(bare);
  });
});

describe("`= derive` under a qualified head", () => {
  test("the refusal reads the qualified head and names the whitelist", () => {
    // The refusal, not a success, is what this seat can pin — and the whitelist
    // is why. The four derivable constraints are pre-registered, so no module
    // may declare or export one (`constraint `Eq` is pre-registered and cannot
    // be redeclared`), and the prelude's own modules do not answer `Alias.Name`
    // in a head either: `honor Show.Show<Box>` is `unknown constraint
    // `Show.Show``. There is therefore no program in which a qualified head
    // names a derivable constraint, and `= derive` under a qualified head is
    // always this message.
    expect(messages([
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + 'import Describe as D\n' +
        "export record Box = {n: Int}\n" +
        "honor D.Describe<Box> = derive\n"],
    ])).toEqual([
      "`D.Describe` cannot be derived; only `Eq`, `Ord`, `Show`, and `Hash` have derivable forms",
    ]);
  });

  test("the bare control is the same refusal, differing only in the face", () => {
    // The head reached the same declaration and the same verdict; the written
    // face is all that changed. Pinned beside the qualified case so that the
    // qualified spelling is visibly not a second code path.
    expect(messages([
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + 'import Describe\n' +
        "export record Box = {n: Int}\n" +
        "honor Describe<Box> = derive\n"],
    ])).toEqual([
      "`Describe` cannot be derived; only `Eq`, `Ord`, `Show`, and `Hash` have derivable forms",
    ]);
  });
});

describe("error paths, as the compiler reports them today", () => {
  // Behaviour pins, not conformance claims: each records the message this
  // compiler emits, so that a change to it is a decision someone makes rather
  // than a drift nobody sees. All three are terse — the alias is known to be a
  // module in the first two, and known to be nothing at all in the third, and
  // none of that reaches the reader. Type position's neighbours are chattier
  // (rule 1's "is a type, not a module" family). Recorded for #567's notebook;
  // no repair is attempted here.

  test("a name the aliased module does not export", () => {
    expect(messages([
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + 'import Describe as D\n' +
        "export record Box = {n: Int}\n" +
        "honor D.NotThere<Box> =\n    describe(value) = \"x\"\n"],
    ])).toEqual(["unknown constraint `D.NotThere`"]);
  });

  test("a name the module exports as a *type*, not a constraint", () => {
    // The constraint namespace is the one consulted (Modules §3.3), so a
    // type-namespace export of that spelling is simply not there. The message
    // cannot say so: it is the same one an absent name gets, with no hint that
    // `D.Marker` exists on the other side.
    expect(messages([
      ["/describe.hex",
        "module Describe\n\n" + "export constraint Describe<a> =\n    describe(value: a): String\n" +
        "export record Marker = {n: Int}\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Describe as D\n' +
        "export record Box = {n: Int}\n" +
        "honor D.Marker<Box> =\n    describe(value) = \"x\"\n"],
    ])).toEqual(["unknown constraint `D.Marker`"]);
  });

  test("a qualifier that is not a module alias at all", () => {
    // `Q` binds nothing here. The report still reads as though the qualified
    // name were one constraint spelling that failed to resolve, rather than an
    // unknown module.
    expect(messages([
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + "export record Box = {n: Int}\n" +
        "honor Q.Describe<Box> =\n    describe(value) = \"x\"\n"],
    ])).toEqual(["unknown constraint `Q.Describe`"]);
  });

  test("`= derive` is judged before the head is resolved", () => {
    // An unknown qualified constraint with `= derive` draws the derivability
    // refusal and never the unknown-constraint one. Pinned because it is the
    // one place the two error paths of this file meet, and the order is not
    // obvious from either message.
    expect(messages([
      DESCRIBE,
      ["/main.hex",
        "module Main\n\n" + 'import Describe as D\n' +
        "export record Box = {n: Int}\n" +
        "honor D.NotThere<Box> = derive\n"],
    ])).toEqual([
      "`D.NotThere` cannot be derived; only `Eq`, `Ord`, `Show`, and `Hash` have derivable forms",
    ]);
  });
});

/**
 * A note this file deliberately does *not* pin, on the cross-module duplicate.
 *
 * Modules §7.3 promises that report as one message naming both modules and both
 * declaration sites — `declared in ./a.hex (line N) and ./b.hex (line M)`. The
 * compiler emits the short message once per colliding site instead, with no
 * file or line in the text. That divergence predates #567 and is untouched by
 * it: the all-bare control above produces exactly the same shape. The pins here
 * therefore record the two message lists as *equal to each other*, and where a
 * literal list is written it is written as current behaviour — not as §7.3
 * conformance, which the compiler does not yet meet.
 */
