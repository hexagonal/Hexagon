import { helloWorld, type PlaygroundExample } from "./hello-world";
import { constraints } from "./constraints";
import { internationalIdentifiers } from "./international-identifiers";
import { modules } from "./modules";
import { patterns } from "./patterns";
import { payloadUnions } from "./payload-unions";
import { records } from "./records";
import { rat } from "./rat";
import { recursion } from "./recursion";
import { sequences } from "./sequences";
import { specializations } from "./specializations";

export const playgroundExamples: readonly PlaygroundExample[] = [
  helloWorld,
  recursion,
  patterns,
  payloadUnions,
  records,
  constraints,
  rat,
  sequences,
  modules,
  specializations,
  internationalIdentifiers,
];

export function exampleById(id: string): PlaygroundExample | undefined {
  return playgroundExamples.find((example) => example.id === id);
}
