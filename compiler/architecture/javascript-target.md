# JavaScript Target Doctrine

**Status:** Initial architecture decision and future specification input. The selection rule is decided; the v1 snapshot date, concrete feature inventory, and minimum Node version remain open until the pre-emitter compatibility review.

## 1. Goal

Hexagon should emit modern JavaScript without chasing the newest syntax merely because it exists. Its default output should be pleasant to read and safe to run across maintained JavaScript environments. Source comments and intentional blank lines between top-level items carry into that output; they are part of how a developer explains and visually groups the program.

The default posture is:

> Use modern features only after the major browser engines have supported them consistently and users have had substantial time to receive that support.

Hexagon therefore bases its portable output profile on **Baseline Widely Available**, whose normal threshold is 30 months after a feature first becomes interoperable across the Baseline browser set.

References:

- [MDN: Baseline compatibility](https://developer.mozilla.org/en-US/docs/Glossary/Baseline/Compatibility)
- [web.dev: How to choose your Baseline target](https://web.dev/articles/how-to-choose-your-baseline-target)

## 2. Features, not publication years

Hexagon does not select its output merely by choosing “the ECMAScript edition published 2.5 years ago.” ECMAScript publication dates and real engine support do not align exactly. One edition may contain features that reached browsers at different times, and some features may have shipped before the edition was published.

Compatibility is therefore evaluated **feature by feature**, including:

- emitted syntax;
- standard built-in objects and methods;
- required module behaviour; and
- semantic details on which emitted code relies.

An emitter that uses conservative syntax but calls a recent unsupported built-in has still violated the target.

## 3. Browser basis

For browsers, an emitted feature may enter Hexagon's default portable profile only after it has reached **Baseline Widely Available**.

At the time of this decision, Baseline covers:

- Safari on macOS and iOS;
- Chrome on desktop and Android;
- Firefox on desktop and Android; and
- Edge on desktop.

Widely Available normally means that 30 months have passed since the last Baseline browser gained interoperable support.

Baseline does not promise support in every historical browser, operating-system webview, embedded engine, or unmaintained device. Hexagon must not describe the profile as literally universal.

## 4. Fixed snapshots, never a live target

Baseline Widely Available is a moving set. `hexc` must never consult a live compatibility database in a way that causes unchanged compiler bits or configuration to change output over time.

Each Hexagon release that changes the portable profile adopts a **fixed, dated snapshot** of the qualifying feature set. The compiler embeds or derives from a reviewed, version-controlled inventory.

Conceptually:

```text
Hexagon portable profile
Snapshot: YYYY-MM
Browser basis: Baseline Widely Available on that date
Module format: ESM
Additional host floor: recorded with the profile
```

Reproducibility is mandatory: the same compiler version, inputs, and options produce the same target decisions without network access.

## 5. More than browsers

Hexagon also intends its portable modules to run in maintained non-browser JavaScript environments, including Node.js, Deno, Bun, workers, and compatible application shells.

Baseline itself covers browsers, not these hosts. The actual portable feature set is therefore the safe intersection of:

```text
release-frozen Baseline Widely Available features
∩ minimum supported Node features
∩ features supported by the other host families Hexagon claims for that profile
```

The pre-emitter review must record the concrete minimum Node version and verify the features used by the runtime and emitter. Other claimed hosts need not receive arbitrary historical-version guarantees, but a known incompatibility excludes a feature from the portable profile or narrows the claim explicitly.

## 6. Language portability versus host APIs

JavaScript environments share the ECMAScript language but not every host API. Hexagon distinguishes portable emitted machinery from APIs deliberately selected by a program.

Examples:

```text
numeric calculation             portable language/runtime behaviour
DOM access                      browser-specific program dependency
Node filesystem import          Node-specific program dependency
edge request/response API       worker-platform-specific dependency
```

`hexc` and the universal Hexagon runtime must not insert Node-, DOM-, or vendor-specific dependencies into otherwise portable output. A program becomes environment-specific through its explicit imports, FFI declarations, or selected platform library.

## 7. Output format

The default output is readable **ECMAScript modules**.

Formatting choices are consistent across source-derived code and compiler-generated
adapters/helpers. Arrow functions use `() =>` for zero parameters, `value =>` for one,
and `(left, right) =>` for several. Object literals use property shorthand whenever a
key and its emitted value are the same identifier. These are JavaScript-output rules;
TypeScript function types retain their required parenthesised parameter lists.

The profile governs both syntax and required built-ins. It also governs private helpers emitted by `hexc` and the platform-neutral runtime: compiler-generated code does not receive permission to use newer features than user-visible emitted code.

The final v1 inventory must state at least:

- permitted syntax features;
- permitted standard built-ins used by emission or runtime;
- ESM assumptions;
- minimum Node version;
- any material browser caveats; and
- helper fallbacks used where a clearer source construct is not yet portable.

## 8. No automatic general polyfills

`hexc` does not automatically inject general browser polyfills or a compatibility layer for historical engines.

Compiler/runtime helpers that implement **Hexagon semantics** remain allowed. They are not general environment polyfills and must themselves obey the portable profile.

Projects that require older browsers or unusual embedded engines may pass the readable emitted modules through ordinary JavaScript bundlers and transpilers. Hexagon should cooperate with that ecosystem through standard ESM, source maps, and predictable output rather than recreating it.

## 9. Readability and downleveling

Hexagon's own default output preserves the readable-JavaScript doctrine. It should prefer a slightly older, clear construct over elaborate compatibility machinery.

External downleveling may produce less readable JavaScript; that is a property of the consuming project's compatibility requirement, not a weakening of `hexc`'s default emission contract.

If Hexagon later supplies additional built-in profiles, each profile must state whether and how its readability promise differs. No additional profile is required for v1.

## 10. Profile evolution

The default profile is conservative but not frozen forever. A later Hexagon release may adopt a newer snapshot after review.

An update must:

1. record the snapshot date and data source;
2. list newly permitted emitter/runtime features;
3. verify browser and claimed non-browser host support;
4. update compatibility and golden tests;
5. state any change in the minimum Node version; and
6. remain deterministic within the released compiler version.

The emitter must not begin using every newly eligible feature automatically. Eligibility permits a design choice; readability, output size, performance, and semantic clarity still decide whether Hexagon uses it.

## 11. Pre-emitter compatibility review

Before JavaScript emission is implemented beyond experimental vertical slices, perform one explicit review that fixes the v1 profile:

1. choose the snapshot date;
2. extract the relevant JavaScript syntax and built-in inventory;
3. select and record the minimum Node version;
4. verify Deno, Bun, workers, and supported browser families at the claimed level;
5. compare every proposed runtime helper and emitted construct against the inventory;
6. decide any helper fallbacks; and
7. turn the resulting inventory into automated compatibility tests or lint rules where practical.

Experimental early slices should use deliberately conservative syntax so they do not prejudge this inventory.

## 12. Decisions and open items

### Decided

- The default is modern readable ESM, not bleeding-edge JavaScript.
- Browser eligibility is based on individual features reaching Baseline Widely Available.
- The 30-month principle is captured through a fixed release snapshot, not a live moving target.
- The actual portable set also respects the supported Node floor and other claimed hosts.
- Syntax, built-ins, compiler helpers, and the platform-neutral runtime all obey the profile.
- Platform-specific APIs enter only through explicit program dependencies.
- `hexc` does not inject general compatibility polyfills.
- Older-environment downleveling is delegated to established JavaScript tooling.
- Eligibility does not force the emitter to use a feature.

### Open

- v1 snapshot date;
- concrete permitted-feature inventory;
- minimum supported Node version;
- exact wording and metadata format used to identify the profile;
- automated enforcement mechanism; and
- whether later releases need optional profiles beyond the conservative default.
