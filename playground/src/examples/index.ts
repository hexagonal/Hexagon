import { helloWorld, type PlaygroundExample } from "./hello-world";
import { internationalIdentifiers } from "./international-identifiers";
import { patterns } from "./patterns";
import { payloadUnions } from "./payload-unions";
import { records } from "./records";
import { recursion } from "./recursion";
import { specializations } from "./specializations";

export const playgroundExamples: readonly PlaygroundExample[] = [
  helloWorld,
  internationalIdentifiers,
  recursion,
  patterns,
  payloadUnions,
  records,
  specializations,
];

export function exampleById(id: string): PlaygroundExample | undefined {
  return playgroundExamples.find((example) => example.id === id);
}
