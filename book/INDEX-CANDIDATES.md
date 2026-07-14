# Index Candidates

This is the working ledger for the book's eventual index. Add technical terms when
they receive a deliberate reader-facing definition; do not wait until the manuscript
is complete and try to recover them from memory.

Chapter references are provisional locators. Pagination will replace them in the
finished index. The principal definition should be distinguished from later
substantial discussions or examples, while incidental mentions should be omitted.
Related forms and likely lookup terms should point to one another.

| Term | Principal definition | Significant later discussion |
| --- | --- | --- |
| associated type | Chapter 21, opening definition | `Iterable.Item`; multiple type members, scope, coherence, and restrictions |
| arity | Chapter 3, “Arity is part of a function” | Chapter 7, tuple arity and tuples versus argument lists; Chapter 8, type-alias arguments |
| as-pattern | Chapter 11, “As-patterns keep the whole value” | See also **pattern** |
| assignment | Chapter 16, “Assignment produces `Unit`” | `:=`; see **mutable variable** and **var** |
| Array, foreign | Chapter 24, “`Array` is borrowed; `Vector` is persistent” | Readonly borrow, stability contract, and explicit conversions |
| binding | Chapter 1, “Bindings introduce names” | `let`, `var`, patterns, and function parameters |
| coherence | Chapter 12, “One type gets one answer” | See also **constraint**, **instance**, and **orphan rule** |
| companion module | Chapter 14, “Companion modules give operations a home” | Chapter 15, dot-call lookup; see **dot call** |
| constraint | Chapter 12, opening definition | Chapter 12 throughout; later collections and FFI chapters |
| constrained export | Chapter 25, opening and “Fundamental types receive direct functions” | Generic function and public dictionaries |
| constrained polymorphism | Chapter 12, opening | See **constraint** |
| constructor | Chapter 10, opening and “Constructors make union values” | Record constructors, union constructors, and exception constructors |
| currying | Chapter 3, “Arity is part of a function” | Not implicit in Hexagon; see **partial application** and **n-ary** |
| default operation | Chapter 12, “A constraint declares the required operations” | Chapter 12, `Eq.notEquals` |
| constraint dictionary | Chapter 25, opening definition | JavaScript object representation, parameters, handles, and factories; see **dictionary** |
| dictionary | Chapter 12, “Concrete code remains concrete” | Chapter 25, **constraint dictionary** |
| derivation | Chapter 13, opening and “Two spellings have one meaning” | See also **instance** |
| destructuring | Chapter 7, “Destructuring binds the positions” | — |
| dot call | Chapter 15, opening definition | See also **companion module**, **method-style call**, and **subject-first** |
| erasure | Chapter 22, “Types erase when values need nothing extra” | Type aliases, nominal constructors, pipes, and dot calls |
| enum, foreign | Chapter 24, “Foreign enums become closed unions” | `extern enum`; TypeScript enums, frozen objects, symbols, and singleton values |
| exhaustiveness | Chapter 10, “`match` handles every alternative” | Chapter 11, “Exhaustiveness protects future changes” |
| exception | Chapter 19, opening and “Exception declarations add constructors to `Exn`” | See also **Exn**, **JsError**, and **Result** |
| Exn | Chapter 19, opening and “Exception declarations add constructors to `Exn`” | Open exception type; see **exception** |
| extern declaration | Chapter 24, opening and “A boundary declaration is a contract” | Foreign modules, members, classes, and callbacks |
| functional cursor | Chapter 18, “`next` exposes a functional cursor” | `Seq.next`; see **Seq** |
| generics | See **polymorphism** | — |
| guard | Chapter 11, “Guards add runtime conditions” | See also **pattern** |
| home module | Chapter 14, “Companion modules give operations a home” | Opacity and instances; Chapter 15 dot calls |
| honor | Chapter 12, “`honor` supplies an instance” | See **constraint**, **instance**, and **derivation** |
| ignore | Chapter 1, “Accidentally discarded values are errors” | Deliberate value discarding; see **Unit** |
| implicit rethrow | Chapter 19, “Missing cases propagate automatically” | See **exception** |
| irrefutable pattern | Chapter 11, “Binding positions require patterns that cannot fail” | — |
| instance | Chapter 12, opening definition | Chapter 12 throughout; Chapter 13, deriving |
| JsError | Chapter 19, “Foreign failures enter through `JsError`” | Foreign JavaScript throwables |
| JsValue | Chapter 24, “Foreign failure stays foreign until decoded” | Explicit decoding of uncertain foreign values |
| let-polymorphism | Chapter 6, “A `let`-bound function can be reused at several types” | See also **value restriction** |
| method-style call | See **dot call** | — |
| monomorphic | Chapter 6, “A parameter has one type within one call” | Chapter 6, value restriction and recursive calls |
| module | Chapter 14, opening definition | Imports, exports, loading, and root execution |
| module alias | Chapter 14, “Imports can be direct or qualified” | Companion-module idiom; modules are not values |
| mutable variable | Chapter 16, opening definition | `var`, `:=`, and lambda boundary |
| n-ary | Chapter 3, “Arity is part of a function” | See **arity** |
| nominal type | Chapter 9, “A declaration gives a record identity” | See also **record** and **type identity** |
| orphan rule | Chapter 12, “One type gets one answer” | See also **coherence** and **instance** |
| opacity | Chapter 14, “Opaque exports hide representation” | Opaque records and unions; Chapter 23 TypeScript brands |
| Nullable | Chapter 24, “`Nullable` is the foreign nullish door” | `NullableCase`; conversion to and from `Option` |
| Option | Chapter 10, “`Option` represents possible absence” | Later collections and FFI chapters |
| or-pattern | Chapter 11, “Or-patterns share one arm” | — |
| partial application | Chapter 3, “Arity is part of a function” | Not implicit in Hexagon; write an explicit lambda; see **currying** |
| pattern | Chapter 11, opening definition | Chapter 11 throughout |
| persistent collection | Chapter 20, opening definition | `Vector`, `Map`, and `Set` |
| polymorphism | Chapter 6, “A `let`-bound function can be reused at several types” | Chapter 6, monomorphic parameters and recursive calls |
| polymorphic recursion | Chapter 6, “Recursive calls keep one type” | — |
| range | Chapter 17, “Ranges are inclusive integer progressions” | `..`, `range`, and `rangeDown` |
| record | Chapter 9, opening definition | See **record, structural** and **record, nominal** |
| record, nominal | Chapter 9, “A declaration gives a record identity” | Chapter 9 throughout |
| record, structural | Chapter 9, opening definition | Chapter 9 throughout |
| Result | Chapter 10, “`Result` represents success or recoverable failure” | Later exceptions and FFI chapters |
| representation-direct | Chapter 24, “A boundary declaration is a contract” | See also **extern declaration** |
| row polymorphism | Chapter 9, “A function can require only the fields it uses” | Chapter 15, unknown-receiver dot calls |
| root module | Chapter 14, “A root module runs without a special `main`” | Module initialization and top-level effects |
| Seq | Chapter 18, opening and “A sequence is lazy and immutable” | Functional cursor, iteration, and collection conversions |
| superconstraint | Chapter 12, “A constraint may require another constraint” | — |
| subject-first | Chapter 3, “Put the subject first” | Chapter 15 throughout; see also **dot call** |
| tuple | Chapter 7, opening definition | Chapter 7, access, destructuring, and tuples versus argument lists |
| trusted boundary | Chapter 24, “A boundary declaration is a contract” | Explicit conversion and decoding |
| type alias | Chapter 8, opening and “An alias names an existing type” | Chapter 8 throughout; see also **transparent type** |
| type inference | Chapter 6, opening and “Types are optional, not absent” | Chapter 6 throughout |
| type parameter | Chapter 8, “Aliases can have parameters” | Later generic declarations |
| transparent type | Chapter 8, “An alias names an existing type” | See **type alias** and **type identity** |
| type identity | Chapter 8, “An alias names an existing type” | Later nominal records and unions |
| union | Chapter 10, opening definition | Chapter 10 throughout; Chapter 11 patterns |
| value restriction | Chapter 6, “Calls do not automatically create reusable polymorphic values” | See also **let-polymorphism** |
| var | Chapter 16, opening and “`var` marks the changing name” | See **assignment** and **mutable variable** |
