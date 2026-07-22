export interface PlaygroundExample {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly specificationReferences: readonly string[];
}

export const helloWorld: PlaygroundExample = {
  id: "hello-world",
  title: "A Tour of Hexagon",
  description: "A commented tour of the language slices implemented so far.",
  source: `// Unions describe a closed set of alternatives.
union Suit =
    | Clubs
    | Diamonds
    | Hearts
    | Spades

// Tuples combine values with different types.
let card = (10, Hearts)

// Patterns unpack structured values.
let (rank, suit) = card

// Concatenation makes greet monomorphic: its argument must be a String.
let greet(name) = "Hello, " ++ name ++ "!"

// Interpolation makes greet2 polymorphic: its argument only needs Show.
let greet2(thing) = "Hello, \${thing}!"

// Annotations document a boundary when useful.
let plus(x: Int, y: Int): Int = x + y

// Recursive functions use fun.
fun factorial(n: Int): Int =
    if n <= 1
    then 1
    else n * factorial(n - 1)

// Match handles every union alternative.
let color(suit: Suit): String = match suit
    Clubs => "black"
    Diamonds => "red"
    Hearts => "red"
    Spades => "black"

// Host console calls are explicit effects and return Unit.
console.log(greet("Hexagon"))
console.log(greet2(5))
`,
  specificationReferences: [],
};
