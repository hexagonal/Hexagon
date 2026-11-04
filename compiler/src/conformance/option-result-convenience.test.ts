import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles, runMain, runProject } from "../support/test-project.js";

/**
 * A mark that claims more than its call does, where the report names no
 * cause, is hedged (Declarations Preamble §1.1): it names the other
 * possibility, its removal is a suggestion, and only the first such report in
 * a module is given.
 */
const perhaps = (message: string, claims: string, silent: string): string =>
  `${message} — perhaps the mark is wrong; or, if this call ${claims}, something makes it ${silent} ` +
  "that this report does not name";

function messages(source: string): readonly string[] {
  return compileFiles([["/main.hex", "module Main\n\n" + source]])
    .diagnostics.map(({ message }) => message);
}

const probeJavascript = `let calls = 0;
let seen = "";
export const reset = () => { calls = 0; seen = ""; };
export const count = value => { calls += 1; return value + 1; };
export const countString = value => { calls += 1; return value.length; };
export const countOption = value => { calls += 1; return { tag: "Some", value: value + 1 }; };
export const countResult = value => { calls += 1; return { tag: "Ok", value: value + 1 }; };
export const eager = () => { calls += 10; return 90; };
export const lazy = () => { calls += 100; return 91; };
export const recover = error => { calls += 100; seen = error.message; return 91; };
export const callCount = () => calls;
export const received = () => seen;
`;

const probeExtern = `extern from "./probe.js"
    fun reset() ->! Unit
    fun count(value: Int) ->! Int
    fun countString(value: String) ->! Int
    fun countOption(value: Int) ->! Option(Int)
    fun countResult(value: Int) ->! Result(Int)
    fun eager() ->! Int
    fun lazy() ->! Int
    fun recover(error: Exn) ->! Int
    fun callCount() ->! Int
    fun received() ->! String
`;

function runWithProbe(source: string): Promise<Record<string, unknown>> {
  const probe = `data:text/javascript;charset=utf-8,${encodeURIComponent(probeJavascript)}`;
  return runProject([
    ["/probe.js", probeJavascript],
    ["/main.hex", `module Main\n\n${probeExtern}\nlet probeReset = reset!()\n${source}`],
  ], {
    transform: (_path, javascript) =>
      javascript.replaceAll('"./probe.js"', JSON.stringify(probe)),
  });
}

function hoveredType(source: string, needle: string): string | undefined {
  const session = new AnalysisSession();
  session.setFile("/main.hex", source);
  return session.hover("/main.hex", source.indexOf(needle))?.displayedType;
}

function companionDeclarations(name: "Option" | "Result"): string {
  const project = compileFiles([["/main.hex", "module Main\n\n" +
    "export let optionMap(source: Option(Int)): Option(Int) = Option.map(source, x => x)\n" +
    "export let resultMap(source: Result(Int)): Result(Int) = " +
    "Result.map(source, x => x)\n"]]);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source }) => source.path.endsWith(`/${name}.hex`))!
    .declarations.text;
}

describe("Option convenience operations", () => {
  test("map and flatMap cover both branches and preserve the flattening boundary", async () => {
    const main = await runMain(`module Main

export let mappedSome: String = match Option.map(Some(3), _ => "changed")
    Some(value) => value
    None => "missing"
export let mappedNone: String = match Option.map(None, (_: Int) => "wrong")
    Some(value) => value
    None => "missing"
export let nested: Int = match Option.map(Some(3), value => Some(value + 1))
    Some(Some(value)) => value
    _ => 0
export let flattened: Int = match Option.flatMap(Some(3), value => Some(value + 2))
    Some(value) => value
    None => 0
export let flatNone: Int = match Option.flatMap(None, (value: Int) => Some(value + 2))
    Some(value) => value
    None => 0
`);

    expect(main).toMatchObject({
      mappedSome: "changed",
      mappedNone: "missing",
      nested: 4,
      flattened: 5,
      flatNone: 0,
    });
  });

  test("callbacks run once only on the selected branch and defaults are eager or lazy", async () => {
    const main = await runWithProbe(`export let mapped: Int = Option.defaultValue(Option.map!(Some(1), count), 0)
let skipped = Option.map!(None, count)
export let afterMap: Int = callCount!()
export let presentEager: Int = Option.defaultValue(Some(2), eager!())
export let afterEager: Int = callCount!()
export let missingEager: Int = Option.defaultValue(None, 92)
export let presentLazy: Int = Option.defaultWith!(Some(3), lazy)
export let afterPresentLazy: Int = callCount!()
export let missingLazy: Int = Option.defaultWith!(None, lazy)
export let afterMissingLazy: Int = callCount!()
export let flatSelected: Int = Option.defaultValue(Option.flatMap!(Some(4), countOption), 0)
export let afterFlatSelected: Int = callCount!()
let flatSkipped = Option.flatMap!(None, countOption)
export let afterFlatSkipped: Int = callCount!()
`);

    expect(main).toMatchObject({
      mapped: 2,
      afterMap: 1,
      presentEager: 2,
      afterEager: 11,
      missingEager: 92,
      presentLazy: 3,
      afterPresentLazy: 11,
      missingLazy: 91,
      afterMissingLazy: 111,
      flatSelected: 5,
      afterFlatSelected: 112,
      afterFlatSkipped: 112,
    });
  });

  test("qualified, pipeline, and dot calls work without payload instances", async () => {
    const main = await runMain(`module Main

opaque union Secret = Secret(value: Int)
let reveal(secret: Secret): Int =
    match secret
        Secret(value) => value
let source: Option(Secret) = Some(Secret(4))
export let qualified: Int = Option.defaultValue(Option.map(source, reveal), 0)
export let piped: Int = source |> Option.map(reveal) |> Option.defaultValue(0)
export let dotted: Int = source.map(reveal).defaultValue(0)
`);

    expect(main).toMatchObject({ qualified: 4, piped: 4, dotted: 4 });
  });

  test("the active book examples compile and run as written", async () => {
    const main = await runMain(`module Main

let guest: Option(String) = Some("Mira")
export let greeting: String =
    guest
    |> Option.map(name => "Hello, \${name}!")
    |> Option.defaultValue("Guest not found")

let findGuest(id: Int): Option(String) =
    if id == 42 then Some("Mira") else None

let requestedId: Option(Int) = Some(42)
export let guestName: Option(String) = requestedId |> Option.flatMap(findGuest)

let makeGuestName(): String = "Guest"
export let eager: String = guest |> Option.defaultValue(makeGuestName())
export let conditional: String = guest |> Option.defaultWith(() => makeGuestName())
`);

    expect(main).toMatchObject({
      greeting: "Hello, Mira!",
      guestName: { tag: "Some", value: "Mira" },
      eager: "Mira",
      conditional: "Mira",
    });
  });

  test("toSeq is zero-or-one and can be traversed repeatedly", async () => {
    const main = await runMain(`module Main

let one = Option.toSeq(Some(7))
let zero: Seq(Int) = Option.toSeq(None)
let chosen: Option(Int) = Some(7)
let doubled = chosen |> Option.toSeq |> Seq.map(number => number * 2)
export let firstLength: Int = Seq.length(one)
export let firstSum: Int = Seq.fold(one, 0, (sum, value) => sum + value)
export let secondLength: Int = Seq.length(one)
export let secondSum: Int = Seq.fold(one, 0, (sum, value) => sum + value)
export let zeroLength: Int = Seq.length(zero)
export let doubledValue: Int = Seq.fold(doubled, 0, (sum, value) => sum + value)
`);

    expect(main).toMatchObject({
      firstLength: 1,
      firstSum: 7,
      secondLength: 1,
      secondSum: 7,
      zeroLength: 0,
      doubledValue: 14,
    });
  });
});

describe("Result convenience operations", () => {
  test("map and flatMap transform only their selected payload", async () => {
    const main = await runMain(`module Main

exception Bad(message: String)
let ok: Result(Int) = Ok(3)
let err: Result(Int) = Err(Bad("bad"))
export let mappedOk: String =
    match Result.map(ok, _ => "changed")
        Ok(value) => value
        Err(_) => "wrong"
export let mappedErr: String =
    match Result.map(err, value => value + 1)
        Ok(_) => "wrong"
        Err(error) => "\${error}"
export let nested: Int =
    match Result.map(ok, value => Ok(value + 1))
        Ok(Ok(value)) => value
        _ => 0
export let flatOk: Int =
    match Result.flatMap(ok, value => Ok(value + 2))
        Ok(value) => value
        Err(_) => 0
export let flatErr: String =
    match Result.flatMap(err, value => Ok(value + 2))
        Ok(_) => "wrong"
        Err(error) => "\${error}"
`);

    expect(main).toMatchObject({
      mappedOk: "changed",
      mappedErr: "Bad: bad",
      nested: 4,
      flatOk: 5,
      flatErr: "Bad: bad",
    });
  });

  test("callbacks receive the selected value once and defaults are eager or lazy", async () => {
    const main = await runWithProbe(`exception Actual(message: String)
let ok: Result(Int) = Ok(1)
let err: Result(Int) = Err(Actual("actual"))
export let mapped: Int = Result.defaultValue(Result.map!(ok, count), 0)
let skipped = Result.map!(err, count)
export let afterMap: Int = callCount!()
export let presentEager: Int = Result.defaultValue(ok, eager!())
export let afterEager: Int = callCount!()
export let missingEager: Int = Result.defaultValue(err, 92)
export let presentLazy: Int = Result.defaultWith!(ok, recover)
export let afterPresentLazy: Int = callCount!()
export let missingLazy: Int = Result.defaultWith!(err, recover)
export let afterMissingLazy: Int = callCount!()
export let receivedError: String = received!()
export let flatSelected: Int = Result.defaultValue(Result.flatMap!(ok, countResult), 0)
export let afterFlatSelected: Int = callCount!()
let flatSkipped = Result.flatMap!(err, countResult)
export let afterFlatSkipped: Int = callCount!()
`);

    expect(main).toMatchObject({
      mapped: 2,
      afterMap: 1,
      presentEager: 1,
      afterEager: 11,
      missingEager: 92,
      presentLazy: 1,
      afterPresentLazy: 11,
      missingLazy: 91,
      afterMissingLazy: 111,
      receivedError: "actual",
      flatSelected: 2,
      afterFlatSelected: 112,
      afterFlatSkipped: 112,
    });
  });
});

describe("public Option and Result faces", () => {
  test.each([
    ["Option.map", "(Option(a), a ->! b) >-> Option(b)"],
    ["Option.flatMap", "(Option(a), a ->! Option(b)) >-> Option(b)"],
    ["Option.defaultValue", "(Option(a), a) -> a"],
    ["Option.defaultWith", "(Option(a), () ->! a) >-> a"],
    ["Option.toSeq", "Option(a) -> Seq(a)"],
    ["Option.toResult", "(Option(a), () -> Exn) -> Result(a)"],
    ["Option.isSome", "Option(a) -> Bool"],
    ["Option.isNone", "Option(a) -> Bool"],
    ["Result.map", "(Result(a), a ->! b) >-> Result(b)"],
    ["Result.flatMap", "(Result(a), a ->! Result(b)) >-> Result(b)"],
    ["Result.defaultValue", "(Result(a), a) -> a"],
    ["Result.defaultWith", "(Result(a), Exn ->! a) >-> a"],
    ["Result.toOption", "Result(a) -> Option(a)"],
    ["Result.isOk", "Result(a) -> Bool"],
    ["Result.isErr", "Result(a) -> Bool"],
    ["Option.orThrow", "(Option(a), () -> Exn) ->^ a"],
    ["Result.orThrow", "Result(a) ->^ a"],
  ])("%s has its exact qualified hover type", (qualified, expected) => {
    const member = qualified.slice(qualified.indexOf(".") + 1);
    const source = `module Main\n\nlet held = ${qualified}\n`;
    expect(hoveredType(source, member)).toBe(expected);
  });

  test("the emitted declarations preserve representative Option and Result signatures", () => {
    const option = companionDeclarations("Option");
    expect(option).toContain(
      "export declare const map: <a, b>(source: Option<a>, transform: (arg0: a) => b) => Option<b>;",
    );
    expect(option).toContain(
      "export declare const defaultValue: <a>(source: Option<a>, fallback: a) => a;",
    );
    expect(option).toContain("export declare const toSeq: <a>(source: Option<a>) => Iterable<a>;");
    expect(option).toContain(
      "export declare const orThrow: <a>(source: Option<a>, failure: () => Error) => a;",
    );

    expect(option).toContain(
      "export declare const toResult: <a>(source: Option<a>, failure: () => Error) => Result<a>;",
    );

    const result = companionDeclarations("Result");
    expect(result).toContain('export type Result<a> = { tag: "Ok"; value: a } | { tag: "Err"; error: Error };');
    expect(result).toContain(
      "export declare const defaultWith: <a>(source: Result<a>, fallback: (arg0: Error) => a) => a;",
    );
    expect(result).toContain("export declare const orThrow: <a>(source: Result<a>) => a;");
    expect(result).toContain("export declare const toOption: <a>(source: Result<a>) => Option<a>;");
    expect(result).not.toContain("mapError");
  });
});

describe("callback effects and exceptions", () => {
  const effectful = `extern from "./effects.js"
    fun touch(value: Int) ->! Int
`;

  test("pure, linked, and effectful callbacks keep the existing call-mark rules", () => {
    expect(messages(
      "export let pure: Option(Int) = Option.map(Some(1), value => value + 1)\n" +
        "export let conduct(source: Option(Int), transform: Int ->! Int): Option(Int) =\n" +
        "    Option.map!(source, transform)\n",
    )).toEqual([]);

    expect(compileFiles([
      ["/effects.js", "export const touch = value => value + 1;"],
      ["/main.hex", "module Main\n\n" + effectful +
        "export let marked: Option(Int) = Option.map!(Some(1), touch)\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);

    expect(compileFiles([
      ["/effects.js", "export const touch = value => value + 1;"],
      ["/main.hex", "module Main\n\n" + effectful +
        "export let missing: Option(Int) = Option.map(Some(1), touch)\n"],
    ]).diagnostics.map(({ message }) => message)).not.toEqual([]);

    expect(messages(
      "export let overmarked: Option(Int) = Option.map!(Some(1), value => value + 1)\n",
    )).not.toEqual([]);

    expect(compileFiles([
      ["/effects.js", "export const touch = value => value + 1;"],
      ["/main.hex", "module Main\n\n" + effectful +
        "let optionFlat: Option(Int) = Option.flatMap!(Some(1), value => Some(touch!(value)))\n" +
        "let resultFlat: Result(Int) = Result.flatMap!(Ok(1), value => Ok(touch!(value)))\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("selected callback exceptions propagate and skipped callbacks are not called", async () => {
    const main = await runMain(`module Main

export exception Boom
let explode(_: Int): Int = throw^(Boom)

export let optionSelected: Bool = match attempt Option.map^(Some(1), explode)
    Err(_) => True
    _ => False
export let optionSkipped: Bool = match attempt Option.map^(None, explode)
    Ok(None) => True
    _ => False
export let resultSelected: Bool = match attempt Result.map^(Ok(1), explode)
    Err(_) => True
    _ => False
let bad: Result(Int) = Err(Boom)
export let resultSkipped: Bool = match attempt Result.map^(bad, explode)
    Ok(Err(_)) => True
    _ => False
`);

    expect(main).toMatchObject({
      optionSelected: true,
      optionSkipped: true,
      resultSelected: true,
      resultSkipped: true,
    });
  });
});

/**
 * **`orThrow`, data back to a failure** (§2, §3; Exceptions §8.4). Each is one
 * function that may fail on its own account, so every call wears `^` and the
 * function that calls it is `->^`; the readings and `attempt` then treat it as
 * any call that may fail. The thrown value is the one the data held, and a
 * fault in it passes a catch-all, as every fault does.
 */
describe("orThrow, the way back from data", () => {
  test("each returns the payload, or throws the exception it is given", async () => {
    const main = await runMain(`module Main

export exception Boom(message: String)

let fromOption(o: Option(String)): String =
    try
        o.orThrow^(() => Boom("absent"))
    catch
        Boom(m) => "thrown: " ++ m
        _ => "something else"

let fromResult(r: Result(String)): String =
    try
        r.orThrow^()
    catch
        Boom(m) => "thrown: " ++ m
        _ => "something else"

export let present: String = fromOption(Some("here"))
export let absent: String = fromOption(None)
export let ok: String = fromResult(Ok("fine"))
export let err: String = fromResult(Err(Boom("bad")))
`);
    expect(main).toMatchObject({
      present: "here",
      absent: "thrown: absent",
      ok: "fine",
      err: "thrown: bad",
    });
  });

  /**
   * `Result.orThrow` throws the `Err`'s own object, so its stack is the one it
   * was built with, and `attempt` over it hands back that same object. Checked by
   * identity, from JavaScript, because "the same object" is the claim.
   */
  test("Result.orThrow rethrows the error itself, stack and all", async () => {
    const main = await runMain(`module Main

exception Boom(message: String)
export let make(): Exn = Boom("built here")
export let roundTrip(r: Result(Int)): Result(Int) = attempt r.orThrow^()
`);
    const made = (main["make"] as () => Error)();
    const back = (main["roundTrip"] as (r: unknown) => { tag: string; error: Error })(
      { tag: "Err", error: made },
    );
    expect(back.tag).toBe("Err");
    expect(back.error).toBe(made);
    expect(back.error.stack).toBe(made.stack);
  });

  /**
   * The thunk runs only for `None`. A thunk that throws a fault is still pure
   * and cannot fail (Exceptions §3), so it is accepted, and the fault shows
   * exactly when the thunk ran.
   */
  test("Option.orThrow builds its exception only for None", async () => {
    const main = await runMain(`module Main

export let lazyFailure(o: Option(Int)): Int = o.orThrow^(() => throw(IndexFault(0, 0)))
`);
    const lazyFailure = main["lazyFailure"] as (o: unknown) => number;
    expect(lazyFailure({ tag: "Some", value: 3 })).toBe(3);
    expect(() => lazyFailure({ tag: "None" })).toThrow(expect.objectContaining({ name: "IndexFault" }));
  });

  test("a fault an Err holds passes a catch-all, as every fault does", async () => {
    const main = await runMain(`module Main

export let makeFault(): Exn = IndexFault(1, 2)
export let guarded(r: Result(Int)): Int =
    try
        r.orThrow^()
    catch
        _ => -1
`);
    const guarded = main["guarded"] as (r: unknown) => number;
    const fault = (main["makeFault"] as () => Error)();
    expect(guarded({ tag: "Ok", value: 5 })).toBe(5);
    expect(() => guarded({ tag: "Err", error: fault })).toThrow(fault);
  });

  test("every call wears `^`, and the mark is checked like any call's", () => {
    expect(messages(
      "exception Boom\n" +
        "let a(o: Option(Int)): Int = Option.orThrow(o, () => Boom)\n" +
        "let b(o: Option(Int)): Int = Option.orThrow!(o, () => Boom)\n" +
        "let c(r: Result(Int)): Int = r.orThrow()\n",
    )).toEqual([
      "this call may fail, so `orThrow` wants `^`, not no mark",
      perhaps("this call is pure, so `orThrow` wants `^`, not `!`", "is impure", "pure"),
      "this call may fail, so `.orThrow` wants `^`, not no mark",
    ]);
  });

  /** The thunk is `() -> Exn`: building the exception is pure and cannot fail. */
  test("a thunk that may fail is refused at the thunk", () => {
    expect(messages(
      "exception Boom\n" +
        "let m(o: Option(Int)) = Option.orThrow^(o, () => throw^(Boom))\n",
    )).toEqual([
      "a `->` arrow promises the function cannot fail, and this function may fail — the demand is written `->`",
    ]);
  });

  test.each([
    ["let held(o: Option(Int)) = o.orThrow^(() => Boom)", "Option(Int) ->^ Int"],
    ["let held(r: Result(Int)) = r |> Result.orThrow^", "Result(Int) ->^ Int"],
    ["let held(o: Option(Int)) = Option.orThrow?(o, () => Boom)", "Option(Int) -> Option(Int)"],
    ["let held(r: Result(Int)) = attempt r.orThrow^()", "Result(Int) -> Result(Int)"],
  ])("%s is %s", (line, expected) => {
    const source = "module Main\n\nexception Boom\n" + line + "\n";
    expect(messages("exception Boom\n" + line + "\n")).toEqual([]);
    expect(hoveredType(source, "held")).toBe(expected);
  });
});

/**
 * **The conversions and the predicates** (§2, §3, #1427). `toOption` and
 * `toResult` throw nothing, so their calls are bare and reach the dot; the
 * thunk of `toResult` runs only for `None`, as `orThrow`'s does. The four
 * predicates read the constructor only, so they ask for no `Eq`.
 */
describe("the conversions between Option and Result, and the predicates", () => {
  test("toOption and toResult are bare calls by the dot, and round-trip", async () => {
    const main = await runMain(`module Main

exception Missing
let ok: Result(Int) = Ok(3)
let err: Result(Int) = Err(Missing)
export let okOption: Int = match ok.toOption()
    Some(value) => value
    None => 0
export let errOption: Bool = err.toOption().isNone()
export let someResult: Int = match Some(4).toResult(() => Missing)
    Ok(value) => value
    Err(_) => 0
export let noneResult: String = match (None: Option(Int)).toResult(() => Missing)
    Ok(_) => "ok"
    Err(error) => "\${error}"
export let roundTrip: Int = match Some(5).toResult(() => Missing).toOption()
    Some(value) => value
    None => 0
`);
    expect(main).toMatchObject({
      okOption: 3,
      errOption: true,
      someResult: 4,
      noneResult: "Missing",
      roundTrip: 5,
    });
  });

  /** The thunk is pure; a fault from it shows exactly when it ran. */
  test("toResult builds its exception only for None", async () => {
    const main = await runMain(`module Main

export let lazyFailure(o: Option(Int)): Result(Int) = o.toResult(() => throw(IndexFault(0, 0)))
`);
    const lazyFailure = main["lazyFailure"] as (o: unknown) => { tag: string };
    expect(lazyFailure({ tag: "Some", value: 3 })).toEqual({ tag: "Ok", value: 3 });
    expect(() => lazyFailure({ tag: "None" })).toThrow(expect.objectContaining({ name: "IndexFault" }));
  });

  test("the four predicates answer on both constructors, with no Eq", async () => {
    const main = await runMain(`module Main

exception Missing
// A function has no Eq, so only the predicates can ask about it.
let present: Option(Int -> Int) = Some((n) => n)
let absent: Option(Int -> Int) = None
let ok: Result(Int -> Int) = Ok((n) => n)
let err: Result(Int -> Int) = Err(Missing)
export let answers: String = "\${present.isSome()} \${present.isNone()} \${absent.isSome()} \${absent.isNone()} " ++
    "\${ok.isOk()} \${ok.isErr()} \${err.isOk()} \${err.isErr()}"
`);
    expect(main["answers"]).toBe("True False False True True False False True");
  });

  test("Result takes one type argument", () => {
    expect(messages("export let r: Result(Int, String) = Ok(1)\n"))
      .toEqual(["type `Result` expects 1 argument, but 2 were provided"]);
  });
});

describe("flatten removes one layer (§2, §3)", () => {
  test("every pair of layers, qualified and by the dot, as bare calls", async () => {
    const main = await runMain(`module Main

exception Missing
let shown(o: Option(Int)): String = match o
    Some(value) => "Some(\${value})"
    None => "None"
let told(r: Result(Int)): String = match r
    Ok(value) => "Ok(\${value})"
    Err(error) => "Err(\${error})"
let lone: Option(Int) = None
let failed: Result(Int) = Err(Missing)
export let options: String = "\${shown(Option.flatten(Some(Some(1))))} \${shown(Some(lone).flatten())} " ++
    "\${shown((None: Option(Option(Int))).flatten())}"
export let results: String = "\${told(Result.flatten(Ok(Ok(2))))} \${told(Ok(failed).flatten())} " ++
    "\${told((Err(Missing): Result(Result(Int))).flatten())}"
export let outer(): Result(Result(Int)) = Err(Missing)
export let innerErr(): Result(Result(Int)) = Ok(failed)
export let flat(r: Result(Result(Int))): Result(Int) = r.flatten()
`);
    expect(main["options"]).toBe("Some(1) None None");
    expect(main["results"]).toBe("Ok(2) Err(Missing) Err(Missing)");
    // Each `Err` keeps its exception: the same value, not a copy.
    const flat = main["flat"] as (r: unknown) => { tag: string; error?: unknown };
    for (const make of [main["outer"], main["innerErr"]] as (() => { tag: string; error?: unknown; value?: { error?: unknown } })[]) {
      const source = make();
      const error = source.tag === "Err" ? source.error : source.value!.error;
      expect(error).toBeDefined();
      expect(flat(source).error).toBe(error);
    }
  });

  test("a value with one layer is refused with the ordinary mismatch", () => {
    expect(messages("let one: Option(Int) = Some(1)\nlet o = Option.flatten(one)\n"))
      .toEqual(["type mismatch: expected Option(a), found Int"]);
  });
});

describe("the new functions take no mark, and a mark is refused", () => {
  // Each in its own module: a hedged mark report is given once per module
  // (the Rewrite Rule's fallback), so one program would show only the first.
  test.each([
    ["let a: Option(Int) = r.toOption^()\n", ".toOption", "^", "may fail", "unable to fail"],
    ["let b: Result(Int) = Some(1).toResult^(() => Missing)\n", ".toResult", "^", "may fail", "unable to fail"],
    ["let c: Bool = Some(1).isSome!()\n", ".isSome", "!", "is impure and may fail", "pure and unable to fail"],
    ["let d: Bool = r.isErr~()\n", ".isErr", "~", "is impure", "pure"],
    ["let e: Option(Int) = Some(Some(1)).flatten^()\n", ".flatten", "^", "may fail", "unable to fail"],
  ])("%s", (line, callee, mark, claims, silent) => {
    const reports = messages("exception Missing\nlet r: Result(Int) = Ok(1)\n" + line);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain(`so \`${callee}\` wants no mark, not \`${mark}\``);
    expect(reports[0]).toContain(`if this call ${claims}, something makes it ${silent}`);
  });
});
