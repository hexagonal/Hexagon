export interface PlaygroundExample {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly specificationReferences: readonly string[];
}

export const helloWorld: PlaygroundExample = {
  id: "hello-world",
  title: "Hello, Hexagon",
  description: "A small module with inferred and annotated private bindings.",
  source:
    'let greet(name) = "Hello, " ++ name ++ "!"\n' +
    "let plus(x: Int, y) = x + y\n" +
    "fun fact(n: Int): Int = if n <= 1 then 1 else n * fact(n - 1)\n" +
    "let answer = 6 * 7\n",
  specificationReferences: [],
};
