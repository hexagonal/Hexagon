import { helloWorld, type PlaygroundExample } from "./hello-world";
import { constraints } from "./constraints";
import { internationalIdentifiers } from "./international-identifiers";
import { modules } from "./modules";
import { patterns } from "./patterns";
import { payloadUnions } from "./payload-unions";
import { polymorphism } from "./polymorphism";
import { records } from "./records";
import { rat } from "./rat";
import { recursion } from "./recursion";
import { sequences } from "./sequences";
import { specializations } from "./specializations";
import { vectors } from "./vectors";

export const playgroundExamples: readonly PlaygroundExample[] = [
  helloWorld,
  recursion,
  patterns,
  payloadUnions,
  records,
  constraints,
  polymorphism,
  rat,
  vectors,
  sequences,
  modules,
  specializations,
  internationalIdentifiers,
];

export function exampleById(id: string): PlaygroundExample | undefined {
  return playgroundExamples.find((example) => example.id === id);
}
