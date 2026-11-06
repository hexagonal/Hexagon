# Regex literals checked and built while compiling: the deliberation record

**Status:** Notes, not normative. The write-ups James ruled on, 2026-11-06, for regex.md §8's check and construction of literal patterns (#1468), kept verbatim as they stood at each ruling, with a status line and, where a claim turned out wrong, a correction added after it. `spec/regex.md` is the decided text. The parts were separate files during the deliberation, `REGEX-BUILD-D1.md` to `REGEX-BUILD-D4.md`, and refer to each other by those names. The probes and measurements they cite were run on the deliberation's branch and machine, and are not kept in the repository.

---

## Regex literals checked when the program compiles (decision 1 of 3)

**Status:** ruled (a) by James on 2026-11-06: only a literal handed to `Regex.compile` is run while compiling, and a fault it throws is refused at the call. James asked for it on 2026-11-06: "A bad regex should be a compile error that secretly catches the Fault from behind the scenes." `regex.md` already promises it: "Once a literal handed to `compile` is checked at build time (§10), a bad one is refused when the program is compiled, and the programmer's code does not change" (§4.2). §10 lists it first among the later phases, and #927's schedule calls it "compile-time literal checking". This decision settles which calls the compiler runs while it compiles. Two smaller decisions follow it: what a literal handed to `parse` gets, and what the playground does.

**Up front:**
- **Doctrine:**
  - **Only a value function can be run while compiling,** because only a value function is sure to give the answer the run would give. `Regex.compile` and `Regex.parse` are value functions of their pattern (Effects §6.2, species (d)).
  - **A bad pattern the programmer wrote is the programmer's mistake.** That is why `compile` throws a fault (Exceptions §1, #1427's ruling). Refusing it at compile time is the same judgment, made earlier.
  - ~~**The messages already meet the Rewrite Rule.** §2.9's messages name the spelling to write instead.~~ *[Corrected after the ruling: most rows do, but thirteen name no fix and twelve can have none. `REGEX-BUILD-D4.md` takes that question.]*
  - **The text decides.** The check reads a literal and never an inferred type, so the Siren test passes.
  - **There is a precedent in Hexagon.** An integer literal past `Int`'s range is already a compile error, and it names the `n` suffix (Numeric Literals §3).
- **Colleague languages:** every language that checks regexes before the run checks them per API, on literal patterns. That includes Swift, Rust (clippy and `lazy-regex`), Go (staticcheck), Java (Error Prone), .NET, TypeScript and Haskell. None of them runs library code to find faults in general.
- **HM:** nothing here touches inference. Typed captures, a later phase, would.

### What exists today (measured on main, Node 24.18.0)

- **A literal pattern is compiled once per load** (§8). The emitter lifts `Regex.compile("…")` into a module-level constant, filled at its first evaluation. A bad literal throws when its call runs, and a call that never runs throws nothing:
  ```
  RegexCompileFault: missing `)` for the group opened here (position: 1)
  RegexCompileFault: `(?=` is lookahead, which the dialect does not have (position: 3)
  ```
  A program with `Regex.compile("(ab")` in a function nobody calls compiles and runs.
- **What a literal costs at load:**
  - Loading the Regex modules took 36 ms.
  - The first compile of an Advent of Code pattern took between 0.2 and 4.7 ms: `\d+` took 0.2 ms, `mul\((\d{1,3}),(\d{1,3})\)` 1.9 ms, and `^(\d+)-(\d+) (\w): (\w+)$` 4.7 ms.
  - A pattern with a Unicode property took about 22 ms (`(?i)\p{L}+`).
  - Every later evaluation reads the constant, in under 0.01 ms.
- **No other fault is caught before the run.** `Int.div(7, 0)`, `[1, 2, 3][5]` and `[1, 2, 3][0]` all compile without a word, and fault when they run.
- **The compiler can't run Hexagon code:**
  - it emits JavaScript as ES modules, which a browser only runs asynchronously, and `compileProject` is synchronous;
  - ~~the language server checks a program without emitting JavaScript at all;~~ *[Corrected after the ruling: the language server compiles through the same `compileProject`, which emits every module the program reaches, even when the program has errors. So one check inside `compileProject` serves `hexc`, the language server and the playground alike. This makes (a) cheaper than stated, and changes nothing else.]*
  - the playground compiles in a browser worker, and its page sets no content security policy;
  - the three Regex modules come to about 210 KB of JavaScript.
- **There is one parser.** #927 ruled that the compiler and the language server load the same parser, `Regex.Syntax` (ruling 9). So a second parser written in TypeScript is not an option.

### The question

When the compiler sees a call whose arguments are literals, which calls does it run while compiling, so that a fault the call would throw becomes a compile error?

### Colleague languages

| | What is checked before the run | Notes |
|---|---|---|
| Swift | regex literals, `/…/` | "The compiler will parse the contents of a regex literal …, diagnosing any errors at compile time." The literal also gives the capture types. `Regex(string)` errors still wait for the run |
| Rust, clippy | a literal or constant argument to `Regex::new`, `RegexBuilder::new` and `RegexSet::new` | `invalid_regex`, in the `correctness` group, which is deny by default. It parses with `regex_syntax`, the parser the `regex` crate itself uses |
| Rust, `lazy-regex` | `regex!("…")` | "regular expressions are checked at compile time, with clear error messages" |
| Go, staticcheck | the pattern of `regexp.Compile` and `regexp.MustCompile` | SA1000, "The regular expression cannot be parsed by the `regexp` package", since 2017 |
| Java, Error Prone | "calls to regex-accepting methods with invalid string literals" | `InvalidPatternSyntax`, severity ERROR. It "deliberately do[es] not check `java.util.regex.Pattern#compile`", because many callers are testing the regex compiler |
| .NET | the pattern in `[GeneratedRegex("…")]` | SYSLIB1042: "The specified regular expression is invalid." The generator emits C# code for the pattern |
| TypeScript 5.5 | regex literals only | "If you try calling `new RegExp` with a string literal, TypeScript will not check the provided string" |
| Haskell, pcre-heavy | a quasiquoted pattern | "a QuasiQuoter for regexps that does compile time checking" |
| Rust, rustc | any operation sure to panic | `unconditional_panic`, deny by default: "division by zero and out-of-bounds array accesses" |

What they agree on:
- **The checks are per API, on literals.** Each check knows the function it guards and reads a literal. Clippy also follows a named constant.
- **There is one parser where the source shows it.** Clippy parses with `regex_syntax`, the same parser the `regex` crate uses at runtime.
- **The general rule is narrower than "run anything".** Rust's `unconditional_panic` covers operations the compiler itself understands, never library code.

### The options

**(a) The two Regex calls only.** A string literal with no interpolation handed to `Regex.compile` goes through `Regex`'s own parser and constructor while the program compiles. `parse` is decision 2's question. The compiler runs `compile`, catches `RegexCompileFault`, and refuses the call with §2.9's message. The report points at the bad codepoint inside the literal, so the editor underlines it as the programmer types. Nothing else runs at compile time.
- **What it gives:**
  - exactly what §4.2 promises, with no change to the programmer's code;
  - the shape of every colleague;
  - the run that checks a literal also gives the program that #927's ruling 3 wants emitted as a constant, so building patterns at compile time later reuses it.
- **Cost:**
  - **The compiler has to run the Regex modules' JavaScript.** It needs them in a form it can run at once, such as one function per module. It builds them once per compiler run or per language-server session, and loading them took 36 ms.
  - **Each literal costs the times above,** once. Keeping each pattern's answer is sound, because `compile` is a value function.
  - **A bad literal in a function nobody calls now stops the build.** §8's sentence saying otherwise changes, as §4.2 already said it would.
- **Later:** (b) can still come with a second customer, without changing anything (a) answers.

**(b) A door the standard library opens function by function.** A standard-library function's declaration says that a call whose arguments are all literals runs while compiling. `Regex.compile` is the first such function, and others join by ruling.
- **What it gives:** the rule in one place, instead of a function the compiler knows by name.
- **Cost:**
  - a new declaration form in Intrinsics;
  - rules for what counts as a literal argument, for example a vector of literals or a negated number;
  - **no second customer today.** The other faults a literal can trigger (`Int.div(7, 0)`, `[1, 2, 3][5]`) belong to operations the compiler knows itself. A check of those would be the compiler's own arithmetic, as the integer range check is, not library code run at build time.

**(c) Every value function whose arguments are all literals, the program's own included.** This is Rust's `unconditional_panic` taken to every function.
- **What it gives:** `Int.div(7, 0)`, `[1, 2, 3][5]` and a programmer's own failing checks are all refused before the run.
- **Cost:**
  - running any Hexagon code while compiling, including a call that never finishes. That needs a budget, and a report for running out of it;
  - every program pays for every literal call, on every keystroke in the editor;
  - **it changes what a fault means.** A fault in code that never runs would stop the build everywhere;
  - it reaches far beyond what was asked.

### Recommendation

**(a).** It is what was asked and what `regex.md` already promises. Every colleague language draws the line the same way, per API and on literals. It needs no new declaration form and no rules for a door that has one customer. The machinery it adds, running the Regex modules' JavaScript inside the compiler, is the same machinery build-time programs need, so nothing is built twice. (b) is the shape to reach for once a second standard-library function needs it. (c) changes what a fault is, and is a language feature of its own.

**What would revisit it:**
- **A second standard-library function** whose literal arguments can be wrong in a way only its own code can tell. That would bring (b).
- **Typed captures** (§10), which need the parsed pattern while types are checked. They would reuse this run.
- **A host where the compiler can't run the JavaScript it emits.**

**The next two decisions, one at a time after this one:**
2. **A literal handed to `parse`.** Either report it as well, since it can only throw, or leave it to the caller, who chose `parse` to read the failure. Error Prone skips `Pattern.compile` for that reason.
3. **The playground.** Either build each literal's program at compile time there too, or keep §8's once-per-load. This is §10's open possibility, and the costs per pattern are measured above.

---

## A literal handed to `Regex.parse` (decision 2 of 3)

**Status:** ruled (a) by James on 2026-11-06: a literal handed to `parse` is left to the caller, lifted and run once per load as today, and only `compile` is checked. Decision 1 is ruled (a): only a literal handed to `Regex.compile` runs while the program compiles, and a fault it throws is refused at the call (`REGEX-BUILD-D1.md`). `regex.md` §8 leaves this question open: "A literal handed to `parse` is the caller's to read, so what the arc does with one is §10's ruling." This decision settles what a literal handed to `parse` gets.

**Up front:**
- **Doctrine:**
  - **#1427 split the two functions by where the pattern comes from.** `compile` is for a pattern the programmer wrote, where a bad one is a mistake, so it throws a fault. `parse` is for a pattern that arrives as data, where a bad one is a failure the caller plans for, so it throws the tracked `RegexError` (Exceptions §1).
  - **The caller of `parse` reads the failure at the call,** with `^`, `?`, `attempt`, `assume` or a catch arm.
  - **The one form that claims the call can't fail is `assume`.** A literal that doesn't parse contradicts that claim from the text alone (Hexagon Way 8).
- **Colleague languages:** the languages with a separate form for a written pattern check only that form, and leave the string constructor alone even when it is handed a literal. That covers Swift's regex literals, TypeScript's regex literals and .NET's attribute. Hexagon's `compile` plays that form's part. The lint tools, clippy and staticcheck, check the one general constructor, because Rust and Go have no such split. Error Prone deliberately leaves Java's `Pattern.compile` alone.
- **HM:** nothing here touches inference.

### What exists today (measured on main)

- **A literal handed to `parse` is lifted and run once per load,** as `compile`'s is (§8). A bad one throws `RegexError` when the call runs, which `?` reads as `None`.
- **No `parse` function is checked before the run.** `Int.parse?("abc")`, `assume Int.parse^("abc")` and `assume Regex.parse^("(")` all compile without a word.
- **Bad literals are handed to `parse` on purpose:**
  - `regex-surface.test.ts` does it, as `Regex.parse^("(")` inside a `try`, to test that the refusal arrives as `RegexError`.
  - The playground's Regular Expressions example shows `parse` failing with `tryPattern("(a")` and `explain("[z-a]")`. Those pass the text through a parameter, so no option below touches them. Written straight into the call, `Regex.parse?("(a")`, the same lesson would meet the compiler under (b).
- **The tree has no other literal handed to `parse`** outside that test file. The playground example writes its own patterns with `compile`; the standard library and the book write none.

### The question

When a literal is handed to `Regex.parse`, does the compiler run it while compiling and refuse the call if it doesn't parse?

### Colleague languages

| | Written-pattern form, checked | String constructor given a literal |
|---|---|---|
| Swift | regex literals `/…/` | `Regex(string)` is not checked; its errors wait for the run |
| TypeScript 5.5 | regex literals | "If you try calling `new RegExp` with a string literal, TypeScript will not check the provided string" |
| .NET | `[GeneratedRegex("…")]`, at build (SYSLIB1042) | not at build. Visual Studio flags a string marked `// lang=regex` (RE0001), which "is IDE-only and not applicable for command-line scenarios" |
| Java, Error Prone | literals handed to "regex-accepting methods" | "We deliberately do not check `java.util.regex.Pattern#compile` as many of its users are deliberately testing the regex compiler or using a vacuously true regex" |
| Rust, clippy | (no separate form) | `invalid_regex` checks `Regex::new`, which answers a `Result` |
| Go, staticcheck | (no separate form) | SA1000 checks both `regexp.Compile`, which answers an error, and `MustCompile`, which panics |

What they agree on: **where a language has a form for written patterns, only that form is checked.** The string form is left to the run, even with a literal. The two tools that check a string constructor do so because it is the only constructor their language has.

### The options

**(a) Leave it to the caller.** A literal handed to `parse` behaves as it does today: it is lifted, run once per load, and a bad one throws `RegexError` when the call runs. Only `compile` is checked.
- **What it gives:**
  - `parse` keeps its one meaning, a pattern whose failure the caller reads;
  - it matches Swift, TypeScript, .NET and Error Prone;
  - it matches Hexagon's other `parse` functions, none of which is checked;
  - tests and lessons that show `parse` failing on a written pattern keep working;
  - decision 1's ruling stays as it stands.
- **Cost:**
  - `assume Regex.parse^("(")`, a written claim that the text contradicts, still compiles, and ends in `AssumptionFault` when it runs;
  - a programmer who hands `parse` their own pattern by mistake gets no check before the run;
  - a good literal handed to `parse` stays once per load, and isn't built at compile time.

**(b) Report it, however the failure is read.** A literal that doesn't parse is refused at either function, with §2.9's message and a rewrite: fix the pattern, or pass the text in from outside.
- **What it gives:** every bad literal is caught before the run, as clippy and staticcheck catch them.
- **Cost:**
  - it refuses the deliberate cases, the repository's own test among them, and a lesson that writes `Regex.parse?("(a")` to show `None`;
  - `?`, `attempt` and a catch arm would be read but never reached, so `parse` stops meaning "the caller reads the failure" whenever its argument is a literal;
  - a second call runs at compile time, widening decision 1's ruling;
  - `Int.parse` is left unchecked, which is a new asymmetry.

**(c) Report it only under `assume`.** `assume Regex.parse^("(")` is refused, with both sides named (Hexagon Way 8): the claim that the call can't fail, and the position where the pattern fails. The fixes are to correct the pattern, to read the failure instead of assuming it away, or to use `Regex.compile` for a pattern written into the program. Every other read form is left to the run.
- **What it gives:** the one form whose claim the text disproves is caught; the deliberate cases, which read the failure, keep working.
- **Cost:**
  - a rule for one read form of one function, while `assume Int.parse^("abc")` stays unchecked, so the asymmetry is narrower but still there;
  - the same widening of decision 1 as (b), for `assume` alone;
  - `assume` checks against a literal would be new; today nothing checks an `assume`.

### Recommendation

**(a).** #1427 split the two functions so that a written pattern goes through `compile`, and decision 1 put the check there. Checking `parse` as well would undo half of that split, for the cases where a programmer chose `parse` precisely to read its failure. Colleague languages with a written-pattern form draw the same line. (c) is the defensible narrower check, but it creates a rule for `assume` on one function that Hexagon has nowhere else.

**What would revisit it:**
- **A general check of `assume` against what the text proves,** across the standard library's `parse` functions. (c) would then come with it, rather than alone.
- **Evidence that programmers hand `parse` their own patterns by mistake,** for example in the playground, or in Advent of Code solutions written in Hexagon.

**Next:** decision 3, the playground. Either build each `compile` literal's program at compile time there too, or keep §8's once-per-load for patterns there.

---

## Regex literals in the playground (decision 3 of 3)

**Status:** ruled (a) by James on 2026-11-06: the playground does what `hexc` does, checking each `compile` literal while compiling and emitting its program as a constant. Decisions 1 and 2 are ruled (a), as `REGEX-BUILD-D1.md` and `REGEX-BUILD-D2.md` record. A literal handed to `Regex.compile` is run while the program compiles, and a fault is refused at the call. A literal handed to `parse` is left to the caller, and runs once per load as today. #927's ruling 3 has a literal's program emitted as a constant. `regex.md` §10 leaves one possibility open: "build-time construction in the installed compiler, and §8's once-per-load in the playground, where compile time matters most." This decision settles what the playground does.

**Up front:**
- **Doctrine:**
  - **5b gives the playground one rule:** every answer it gives is one Node gives in some real situation. A program that `hexc` refuses must therefore be refused in the playground too. All three options below keep the run's answers the same, because §8 says "no semantics ride on the sharing".
  - **Emitted JavaScript is what a human would write unless measurably slower.** The measurements below decide that question, place by place.
- **Colleague languages:** a playground runs the real compiler. The Rust and Go playgrounds run theirs on a server, and the TypeScript Playground runs the TypeScript compiler itself in the browser, so its JavaScript pane shows what `tsc` emits.
- **HM:** nothing here touches inference.

### What exists today (measured on main, Node 24.18.0)

- **The playground compiles 200 ms after each edit,** in a compiler worker, and shows the emitted JavaScript in its generated-code view. Every Run follows a compile.
- **A compile of a small program that imports Regex** took 2.1 s the first time, while the standard library compiled, and 42 to 55 ms after that. Its `Main.js` was 293 characters.
- **What one pattern costs, warmed up (the program as it compiles on the next edit):**

  | Pattern | Parse alone (the check) | Parse and build |
  |---|---|---|
  | `^(\d+)-(\d+) (\w): (\w+)$` | 0.09 ms | 0.32 ms |
  | `^Valve (\w+) has flow rate=(\d+); tunnels? leads? to valves? (.*)$` | 0.11 ms | 0.84 ms |
  | `\d+` | 0.02 ms | 0.06 ms |
  | `(?i)\p{L}+` | 9.5 ms | 11.4 ms |
  | `\p{Greek}+\|\p{Han}+` | 12.6 ms | 15.2 ms |

  The first time in a fresh process each costs more: 0.2 to 4.7 ms, and about 22 ms with a Unicode property. Loading the Regex modules took 36 ms, once. Keeping each pattern's answer is sound (decision 1), so an edit that leaves a literal unchanged pays nothing for it.
- **What a built program would add to the emitted JavaScript,** estimated as JSON of the program's fields: 1.6 KB for `\d+`, 3.9 KB for `^(\d+)-(\d+) (\w): (\w+)$`, and 12 KB for the `Valve` pattern. Unicode tables stay in the runtime, referenced by name (#927 ruling 3), so `(?i)\p{L}+` is also 1.6 KB.
- **The once-per-load lifting stays in the compiler whatever is ruled here,** because decision 2 keeps it for `parse` literals.

### The question

In the playground, is a `compile` literal checked and built while compiling, as `hexc` does, or handled differently?

### The options

**(a) The same as `hexc`.** The playground checks each literal while compiling, and emits its program as a constant.
- **What it gives:**
  - one compiler and one output; the generated-code view shows what `hexc` emits;
  - a Run skips building each pattern, which saves 0.06 to 0.84 ms per pattern warmed up, more on a first run, and about 22 ms for a Unicode property.
- **Cost:**
  - each new or changed literal adds its parse-and-build time to the next compile;
  - the generated-code view grows by a table of 1.6 to 12 KB per pattern, in a 293-character program like the one above.

**(b) Check while compiling, but build once per load.** The playground refuses what `hexc` refuses. It emits a `compile` literal through §8's lifting, as `parse` literals already are, so the view reads `Regex.compile("…")` and the program is built when the Run first reaches it.
- **What it gives:**
  - a generated-code view a reader can follow, with no tables;
  - the cheapest compile per edit;
  - no extra machinery, because the lifting stays anyway.
- **Cost:**
  - **The playground's JavaScript differs from `hexc`'s** for every `compile` literal. The view no longer shows exactly what the installed compiler emits, though the run's answers are the same.
  - a Run pays each pattern's build: under 1 ms for these patterns warmed up, and about 22 ms for a Unicode property on a first run.

**(c) No check in the playground.** The compiler worker never runs Regex. A bad literal throws its fault when the Run reaches it, as today.
- **What it gives:** the playground's compiler stays as it is, and doesn't load the Regex modules.
- **Cost:** a program the playground accepts would be refused by `hexc`. That breaks 5b's rule, and loses the check where newcomers, who make the most mistakes, are writing patterns.

### Recommendation

**(a).** The measurements remove the reason §10 gave for a different playground. The check costs at most a fraction of a millisecond for an ordinary pattern, on a compile that already takes about 50 ms, and an unchanged literal costs nothing. Building costs under a millisecond more. What is left is a trade between a readable generated-code view (b) and a view that shows what `hexc` really emits (a). The view exists to show what Hexagon compiles to, so (a)'s fidelity serves it better, at the price of a table per pattern. (b) is a reasonable choice if the view's readability matters more than its fidelity. (c) breaks 5b.

**What would revisit it:**
- **Learners finding the tables in the view confusing.** The view could fold a pattern's table behind its pattern, without changing what is emitted.
- **A playground compile that grows slow enough to feel,** for example a program with many Unicode-property patterns, each about 10 ms on its first compile.

**Then:** the spec amendment (`regex.md` §4.2, §8 and §10, with the three rulings) and its SPEC-ONLY issue, followed by the implementation. The compiler would run Regex's own JavaScript while compiling, refuse a bad `compile` literal at the bad codepoint, emit programs as constants, and give the language server the same check.

---

## What a refused Regex literal tells the programmer to write (decision 4)

**Status:** ruled (a) by James on 2026-11-06: a refused literal names the rewrite where one exists, and the limitation where none does. The rows that named no fix gain one, an unknown property takes the near-miss form every unknown name takes, and the dialect's rewrite-less refusals join polymorphic recursion as named limitations in Declarations Preamble §1.1, each with its reason. *Revised before the ruling, 2026-11-06 at about 15:25Z and again at about 15:50Z, after two independent reviews of the spec PR (#1469) found my inventory incomplete. The question, the options and the recommendation are unchanged. "What the reviews changed" lists every difference from the version sent at 15:05Z.*

Decision 1 (`REGEX-BUILD-D1.md`) makes a bad literal handed to `Regex.compile` a compile error, and its write-up said: "**The messages already meet the Rewrite Rule.** §2.9's messages name the spelling to write instead." While drafting the spec I checked every message the parser gives. That sentence is true of most rows and false of the rest, so I am bringing the question back rather than deciding it inside the spec.

**Up front:**
- **Doctrine:**
  - **The Rewrite Rule** (Declarations Preamble §1.1): "Every restrictive hard error must have a local, obvious rewrite — and the diagnostic must name it." And: "A restriction whose row cannot name a local rewrite is returned to design or recorded as an open question — it does not ship as a bare rejection."
  - **The rule has one named exception today:** "One restriction has no local rewrite, and the language keeps it on purpose: polymorphic recursion … The rewrite other languages offer … is … rejected permanently … So the diagnostic names the rule it meets and the limitation itself … and offers no rewrite, since any it named would be wrong."
  - **An unknown name already has its own form.** Hexagon reports it with the near name when one is close: "`Direction` has no constructor `Nort`" plus "did you mean `North`?" (Pattern Matching §12; the same in Constraints, Method Syntax §9 and Modules). The compiler offers a name only within a third of its length, and otherwise lets the sentence stand alone.
  - **§2.9's messages were written for the run,** as `RegexError` and `RegexCompileFault`, where the Rewrite Rule does not reach. Once they are compile errors, it does.
- **Colleague languages:** none of the compile-time regex checks names a rewrite as a rule. Clippy's `invalid_regex`, .NET's SYSLIB1042 and Swift's regex literals all show their parser's message as it stands. The Rewrite Rule is Hexagon's own, and stricter.
- **HM:** nothing here touches inference.

### What the reviews changed

1. **A rewrite in a compile-time report has to be spelled as source.** `Regex.compile("a\\")` is refused at its closing quote with "write `\\` for a literal backslash", which is what the programmer already wrote: the pattern's `\\` is the source's `\\\\`. So a report made while compiling quotes every spelling as a string literal spells it, each backslash doubled (Lexer §6.2). This holds under every option below.
2. **Several of §2.8's refusals have no message of their own, and the general one points somewhere wrong.** Each of these suggestions changes the meaning:
   - possessive `a*+` gets "`*+` repeats a repetition; write `(a*)+`";
   - atomic `(?>a)` and the conditional `(?(1)a|b)` get "`(?` must be followed by `:`, `P<`, `<`, or flags", which steers toward `(?:`;
   - recursion `(?R)` gets "`R` is not a flag";
   - other engines' backreferences, `\k<name>` and `\g1`, get "`\k` is not an escape; write `k`, or see the escape table".

   They join the rows with no rewrite, and are refused by name. Possessive repetition keeps the other reading's rewrite: "to repeat a repetition, write `(a*)+`".
   Three more spellings from other engines have a fix and join group 2: `(?#…)`, a comment (drop it, or use the `x` flag's `#`); `\K` (capture the part to keep in a group); and `\G` (search with `findFrom` and check where the match starts). `\c`, a control codepoint, joins the rows that already name `\u{…}`.
3. **The `U` flag** gets "`U` is not a flag; the flags are `i`, `m`, `s`, `x`". It has a fix, a lazy repetition such as `*?`, so it joins group 2.
4. **`[\b]` means backspace in JavaScript, PCRE and Python,** so "write it outside the class" is wrong for the common case. The row names both readings: `\u{8}` for a backspace, or outside the class for a word boundary.
5. **An unknown property is an unknown name, not a limitation.** `\p{Cyrilic}` is a typo of `\p{Cyrillic}`. It leaves the rows with no rewrite and takes the near-miss form above: "did you mean `\p{Cyrillic}`?" when a supported name is close, and the sentence alone when none is (`\p{Emoji}`, which §10 may add by ruling).
6. **Two of the three bounds have a rewrite.** `a{1000}a{500}` is legal and builds the program `a{1500}` would, because §2.5 bounds the program at a thousand times the pattern's length, and the longer spelling pays for itself. Nested counts the same way: repeat the outer repetition in sequence. Both join group 2. Nesting deeper than 1000 has no such rewrite and stays with the rows that have none.

7. **Lookaround's ground was misstated.** I wrote that no linear-time engine has these constructs. That is true of backreferences, but §2.8 itself says lookaround is "expressible on a linear engine only in restricted forms, and each form is a second matching semantics beside leftmost-first". So the ground for the group is §2.8's: the dialect refuses them to keep matching linear-time and leftmost-first.

So group 2 grows from thirteen rows to nineteen, the unknown property becomes a group of its own, and the rows with no rewrite (now group 4) go from twelve to fifteen: they lose the property row and two bounds, and gain four constructs and two spellings of a backreference.

### What exists today (read from `stdlib/Regex/Syntax.hex` on main)

The parser's messages fall into four groups.

1. **Rows that name the spelling or the form.** Most of them do, for example:
   - "unmatched `)`; write `\)` for a literal";
   - "`\x` is not an escape; write `\u{…}`";
   - "`\Z` is not an escape; write `\z`, …";
   - "group name must match `[A-Za-z_][A-Za-z0-9_]*`".
2. **Rows whose fix is obvious but unnamed.** There are nineteen:
   - "missing `)` for the group opened here", and the same for `]`;
   - "range `z-a` is reversed";
   - "`{3,1}` has a minimum above its maximum";
   - "nothing to repeat before `*`";
   - "pattern ends inside an escape";
   - "`\b` is an assertion, not a codepoint; a class cannot hold it";
   - "`i` is set twice", "nothing follows `-`" and "`(?)` sets no flag";
   - "group `year` is already defined";
   - "`\R` is not an escape; the dialect has no linebreak atom" and the same for `\h`. A class or an alternation can spell what the writer meant;
   - "`U` is not a flag", where a lazy repetition says what `U` would;
   - "repetition count exceeds 1000" and "nested repetition counts multiply past 1000", where a sequence spells the longer run;
   - `(?#…)`, `\K` and `\G`, which other engines read as a comment, a reset of the match's start, and an anchor at the previous match's end. Today these get general messages that name a wrong fix ("write `K`", or the `(?` prefix list).
3. **An unknown name:** "`\p{Cyrilic}` names no supported property". It takes the near-miss form every unknown name in Hexagon takes. A real property outside the closed set, such as `\p{Emoji}`, gets the sentence alone; whether it joins is already §10's open question.
4. **Rows with no rewrite inside the dialect.** Each refuses a construct by ruling, or meets a bound. There are fifteen:
   - **Constructs §2.8 refuses to keep matching linear-time and leftmost-first:**
     - backreferences (`\1`, `(?P=name)`, `\k<name>`, `\g1`), which no linear-time engine matches in general;
     - the four lookaround forms, which a linear engine has only in restricted forms, each a second matching semantics beside leftmost-first;
     - possessive repetition, atomic groups and conditionals, §2.8's backtracking-engine devices;
     - recursion, which matches what no finite automaton can, such as balanced nesting.

     The rewrite other engines offer is an engine §1 rejects.
   - **Atoms whose unit is not the codepoint:** the grapheme and byte atoms, `\X` and `\C`. The dialect matches codepoints (§3.1), and a grapheme or a byte is not one, so there is nothing inside the dialect to write instead.
   - **Nesting deeper than 1000** (§2.5). The bound keeps every pass over the tree bounded. A pattern that deep is generated, not written, and no local rewrite removes the depth without changing what the groups capture.

   Their messages already name the limitation, as in "`(?=` is lookahead, which the dialect does not have". A rewrite named here would be wrong, exactly as for polymorphic recursion.

### The question

How does a refused literal meet the Rewrite Rule?

### The options

**(a) Name the rewrite where one exists, and name the limitation where none does.**
- **Group 2:** each row gains its rewrite, for example:
  - "range `z-a` is reversed; write `a-z`";
  - "nothing to repeat before `*`; write `\*` for a literal `*`";
  - "pattern ends inside an escape; write `\\` for a literal backslash";
  - "repetition count exceeds 1000; write a longer run as a sequence, such as `x{1000}x{500}` for `x{1500}`".

  The same words serve `parse`'s `RegexError` at the run, where the spellings are the pattern's own.
- **Group 3:** the unknown property takes the near-miss form.
- **Group 4:** keeps its messages, which name the limitation and its reason, and the constructs that fell to a general message gain their own. The Preamble's named-limitation paragraph gains the dialect's rewrite-less refusals beside polymorphic recursion, each with its reason. The ground is the same: the rewrite other languages offer is one Hexagon rejects.
- **What it gives:**
  - every report says what to write, or why nothing can be written;
  - better run-time messages for `parse` as well;
  - the doctrine says in one place where a rule has no rewrite.
- **Cost:**
  - every group 2 message changes, the unknown property gains its near miss, and the spellings that fell to a general message gain their own, in the spec table, the parser and its tests;
  - the Preamble's exception grows from one restriction to a family. It is named, ruled and reasoned, but it is still wider.

**(b) One rewrite at the call for every report.** Every report ends with the same clause: "or hand the text to `Regex.parse`, which reports this when the call runs."
- **What it gives:**
  - no message changes;
  - a rewrite that is always local and always legal.
- **Cost:**
  - **The clause defers the failure without fixing it.** It is the one piece of advice a programmer with a bad pattern never needs, so it fails the rule's "obvious" in spirit while passing its letter.
  - group 2 still names no fix, and the spellings that fell to a general message keep messages that point the wrong way.

**(c) Rewrites for group 2, and group 4 as an open question.** Groups 2 and 3 are the same as (a). Group 4 is recorded under the Rewrite Rule's own escape, "recorded as an open question", with no Preamble change.
- **What it gives:** no doctrine edit now.
- **Cost:** an open question with no prospect of closing. The constructs are refused for good (§11), so "open" would be untrue.

### Recommendation

**(a).** Group 2 is plain: those messages should name their fix, and the run-time reports improve too. Group 3 is what Hexagon already does for every unknown name. Group 4 is the same case as polymorphic recursion, a restriction kept on purpose whose foreign rewrite Hexagon rejects. Naming it as such in the Preamble keeps one doctrine rather than a quiet second exception inside the regex spec. (b) satisfies the letter with advice nobody needs. (c) records as open something that is settled.

**What would revisit it:**
- **A linear-time form of lookaround** entering the dialect. Group 4 would then shrink.
- **A third family of rewrite-less restrictions** elsewhere in the language. That would suggest the Preamble's paragraph wants a general test rather than a list.

**Meanwhile:** I am revising the spec amendment (#1469) for decisions 1 to 3 with (a) in place, marked as waiting on this ruling. Nothing merges before you rule.
