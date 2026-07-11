export interface PlaygroundExample {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly specificationReferences: readonly string[];
}

/** Establishes the example metadata shape without claiming compiler support. */
export const helloWorld: PlaygroundExample = {
  id: "hello-world",
  title: "Hello, Hexagon",
  description: "A minimal program that writes a greeting.",
  source: 'print("Hello, Hexagon!")\n',
  specificationReferences: [],
};
