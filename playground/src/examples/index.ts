import { helloWorld, type PlaygroundExample } from "./hello-world";
import { patterns } from "./patterns";
import { payloadUnions } from "./payload-unions";
import { records } from "./records";
import { recursion } from "./recursion";

export const playgroundExamples: readonly PlaygroundExample[] = [
  helloWorld,
  recursion,
  patterns,
  payloadUnions,
  records,
];

export function exampleById(id: string): PlaygroundExample | undefined {
  return playgroundExamples.find((example) => example.id === id);
}
