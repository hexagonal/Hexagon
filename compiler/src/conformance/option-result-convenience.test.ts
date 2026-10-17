import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles, runMain, runProject } from "../support/test-project.js";

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
export const recover = error => { calls += 100; seen = error; return 91; };
export const callCount = () => calls;
export const received = () => seen;
`;

const probeExtern = `extern from "./probe.js"
    fun reset() ->! Unit
    fun count(value: Int) ->! Int
    fun countString(value: String) ->! Int
    fun countOption(value: Int) ->! Option(Int)
    fun countResult(value: Int) ->! Result(Int, String)
    fun eager() ->! Int
    fun lazy() ->! Int
    fun recover(error: String) ->! Int
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
    "export let resultMap(source: Result(Int, String)): Result(Int, String) = " +
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
  test("map, flatMap, and mapError transform only their selected payload", async () => {
    const main = await runMain(`module Main

let ok: Result(Int, String) = Ok(3)
let err: Result(Int, String) = Err("bad")
export let mappedOk: String =
    match Result.map(ok, _ => "changed")
        Ok(value) => value
        Err(_) => "wrong"
export let mappedErr: String =
    match Result.map(err, value => value + 1)
        Ok(_) => "wrong"
        Err(error) => error
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
        Err(error) => error
export let changedError: Int =
    match Result.mapError(err, String.length)
        Ok(_) => 0
        Err(size) => size
export let untouchedOk: Int =
    match Result.mapError(ok, String.length)
        Ok(value) => value
        Err(_) => 0
`);

    expect(main).toMatchObject({
      mappedOk: "changed",
      mappedErr: "bad",
      nested: 4,
      flatOk: 5,
      flatErr: "bad",
      changedError: 3,
      untouchedOk: 3,
    });
  });

  test("callbacks receive the selected value once and defaults are eager or lazy", async () => {
    const main = await runWithProbe(`let ok: Result(Int, String) = Ok(1)
let err: Result(Int, String) = Err("actual")
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
let error: Result(Int, String) = Err("error")
export let errorSelected: Int =
    match Result.mapError!(error, countString)
        Err(value) => value
        Ok(_) => 0
export let afterErrorSelected: Int = callCount!()
let errorSkipped = Result.mapError!(ok, countString)
export let afterErrorSkipped: Int = callCount!()
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
      errorSelected: 5,
      afterErrorSelected: 113,
      afterErrorSkipped: 113,
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
    ["Result.map", "(Result(a, b), a ->! c) >-> Result(c, b)"],
    ["Result.flatMap", "(Result(a, b), a ->! Result(c, b)) >-> Result(c, b)"],
    ["Result.mapError", "(Result(a, b), b ->! c) >-> Result(a, c)"],
    ["Result.defaultValue", "(Result(a, b), a) -> a"],
    ["Result.defaultWith", "(Result(a, b), b ->! a) >-> a"],
    ["Option.orThrow", "(Option(a), () -> Exn) ->^ a"],
    ["Result.orThrow", "Result(a, Exn) ->^ a"],
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

    const result = companionDeclarations("Result");
    expect(result).toContain(
      "export declare const mapError: <a, b, c>(source: Result<a, b>, transform: (arg0: b) => c) => Result<a, c>;",
    );
    expect(result).toContain(
      "export declare const defaultWith: <a, b>(source: Result<a, b>, fallback: (arg0: b) => a) => a;",
    );
    expect(result).toContain("export declare const orThrow: <a>(source: Result<a, Error>) => a;");
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
        "let resultFlat: Result(Int, String) = Result.flatMap!(Ok(1), value => Ok(touch!(value)))\n" +
        "let resultError: Result(Int, Int) = Result.mapError!(Err(1), touch)\n"],
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
export let resultSkipped: Bool = match attempt Result.map^(Err("bad"), explode)
    Ok(Err("bad")) => True
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

let fromResult(r: Result(String, Exn)): String =
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
export let roundTrip(r: Result(Int, Exn)): Result(Int, Exn) = attempt r.orThrow^()
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
export let guarded(r: Result(Int, Exn)): Int =
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
        "let c(r: Result(Int, Exn)): Int = r.orThrow()\n",
    )).toEqual([
      "this call may fail, so `orThrow` wants `^`, not no mark",
      "this call is pure, so `orThrow` wants `^`, not `!`",
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
    ["let held(r: Result(Int, Exn)) = r |> Result.orThrow^", "Result(Int, Exn) ->^ Int"],
    ["let held(o: Option(Int)) = Option.orThrow?(o, () => Boom)", "Option(Int) -> Option(Int)"],
    ["let held(r: Result(Int, Exn)) = attempt r.orThrow^()", "Result(Int, Exn) -> Result(Int, Exn)"],
  ])("%s is %s", (line, expected) => {
    const source = "module Main\n\nexception Boom\n" + line + "\n";
    expect(messages("exception Boom\n" + line + "\n")).toEqual([]);
    expect(hoveredType(source, "held")).toBe(expected);
  });
});
