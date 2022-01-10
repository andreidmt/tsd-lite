import * as ts from "@tsd/typescript";
import { Assertion } from "./handleAssertions";
import type { Location } from "./types";

const assertionFnNames = new Set<string>(Object.values(Assertion));

export function extractAssertions(program: ts.Program): {
  assertions: Map<Assertion, Set<ts.CallExpression>>;
  assertionCount: number;
} {
  const assertions = new Map<Assertion, Set<ts.CallExpression>>();

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const identifier = node.expression.getText();

      if (assertionFnNames.has(identifier)) {
        const assertion = identifier as Assertion;

        const nodes = assertions.get(assertion) ?? new Set<ts.CallExpression>();

        nodes.add(node);

        assertions.set(assertion, nodes);
      }
    }

    ts.forEachChild(node, visit);
  }

  for (const sourceFile of program.getSourceFiles()) {
    visit(sourceFile);
  }

  let assertionCount = 0;
  assertions.forEach((nodes) => {
    assertionCount += nodes.size;
  });

  return { assertions, assertionCount };
}

export function parseErrorAssertionToLocation(
  assertions: Map<Assertion, Set<ts.CallExpression>>
): Map<Location, ts.Node> {
  const nodes = assertions.get(Assertion.EXPECT_ERROR);

  const expectedErrors = new Map<Location, ts.Node>();

  if (!nodes) {
    return expectedErrors;
  }

  for (const node of nodes) {
    const location = {
      fileName: node.getSourceFile().fileName,
      start: node.getStart(),
      end: node.getEnd(),
    };

    expectedErrors.set(location, node);
  }

  return expectedErrors;
}
