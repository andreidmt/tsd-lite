import * as ts from "@tsd/typescript";
import { handleAssertions } from "./handleAssertions";
import { extractAssertions, parseErrorAssertionToLocation } from "./parser";
import { resolveCompilerOptions } from "./resolveCompilerOptions";
import type { ExpectedError, Location, TsdResult } from "./types";

enum DiagnosticCode {
  AwaitExpressionOnlyAllowedWithinAsyncFunction = 1308,
  TopLevelAwaitOnlyAllowedWhenModuleESNextOrSystem = 1378,
  GenericTypeRequiresTypeArguments = 2314,
  TypeIsNotAssignableToOtherType = 2322,
  PropertyDoesNotExistOnType = 2339,
  TypeDoesNotSatisfyTheConstraint = 2344,
  ArgumentTypeIsNotAssignableToParameterType = 2345,
  ValueOfTypeNotCallable = 2348,
  ExpressionNotCallable = 2349,
  OnlyVoidFunctionIsNewCallable = 2350,
  ExpressionNotConstructable = 2351,
  CannotAssignToReadOnlyProperty = 2540,
  ExpectedArgumentsButGotOther = 2554,
  ExpectedAtLeastArgumentsButGotOther = 2555,
  TypeHasNoPropertiesInCommonWith = 2559,
  NoOverloadExpectsCountOfArguments = 2575,
  ThisContextOfTypeNotAssignableToMethodOfThisType = 2684,
  PropertyMissingInType1ButRequiredInType2 = 2741,
  NoOverloadExpectsCountOfTypeArguments = 2743,
  NoOverloadMatches = 2769,
  StringLiteralTypeIsNotAssignableToUnionTypeWithSuggestion = 2820,
  MemberCannotHaveOverrideModifierBecauseItIsNotDeclaredInBaseClass = 4113,
  MemberMustHaveOverrideModifier = 4114,
  NewExpressionTargetLackingConstructSignatureHasAnyType = 7009,
}

// List of diagnostic codes that should be ignored in general
const ignoredDiagnostics = new Set<number>([
  // Older TS version report 'await expression only allowed within async function
  DiagnosticCode.AwaitExpressionOnlyAllowedWithinAsyncFunction,
  DiagnosticCode.TopLevelAwaitOnlyAllowedWhenModuleESNextOrSystem,
]);

// List of diagnostic codes which should be ignored inside `expectError` statements
const expectErrorDiagnosticCodesToIgnore = new Set<DiagnosticCode>([
  DiagnosticCode.ArgumentTypeIsNotAssignableToParameterType,
  DiagnosticCode.PropertyDoesNotExistOnType,
  DiagnosticCode.CannotAssignToReadOnlyProperty,
  DiagnosticCode.TypeIsNotAssignableToOtherType,
  DiagnosticCode.TypeDoesNotSatisfyTheConstraint,
  DiagnosticCode.GenericTypeRequiresTypeArguments,
  DiagnosticCode.ExpectedArgumentsButGotOther,
  DiagnosticCode.ExpectedAtLeastArgumentsButGotOther,
  DiagnosticCode.NoOverloadExpectsCountOfArguments,
  DiagnosticCode.NoOverloadExpectsCountOfTypeArguments,
  DiagnosticCode.NoOverloadMatches,
  DiagnosticCode.PropertyMissingInType1ButRequiredInType2,
  DiagnosticCode.TypeHasNoPropertiesInCommonWith,
  DiagnosticCode.ThisContextOfTypeNotAssignableToMethodOfThisType,
  DiagnosticCode.ValueOfTypeNotCallable,
  DiagnosticCode.ExpressionNotCallable,
  DiagnosticCode.OnlyVoidFunctionIsNewCallable,
  DiagnosticCode.ExpressionNotConstructable,
  DiagnosticCode.NewExpressionTargetLackingConstructSignatureHasAnyType,
  DiagnosticCode.MemberCannotHaveOverrideModifierBecauseItIsNotDeclaredInBaseClass,
  DiagnosticCode.MemberMustHaveOverrideModifier,
  DiagnosticCode.StringLiteralTypeIsNotAssignableToUnionTypeWithSuggestion,
]);

const isDiagnosticWithLocation = (
  diagnostic: ts.Diagnostic
): diagnostic is ts.DiagnosticWithLocation => diagnostic.file !== undefined;

function isIgnoredDiagnostic(
  diagnostic: ts.DiagnosticWithLocation,
  expectedErrors: Map<Location, ExpectedError>
) {
  if (ignoredDiagnostics.has(diagnostic.code)) {
    return "ignore";
  }

  if (!expectErrorDiagnosticCodesToIgnore.has(diagnostic.code)) {
    return "preserve";
  }

  const diagnosticFileName = diagnostic.file.fileName;
  const diagnosticStart = diagnostic.start;

  for (const [location] of expectedErrors) {
    if (
      diagnosticFileName === location.fileName &&
      diagnosticStart > location.start &&
      diagnosticStart < location.end
    ) {
      return location;
    }
  }

  return "preserve";
}

export function tsdLite(testFilePath: string): {
  assertionCount: number;
  tsdResults: Array<TsdResult>;
  tsdErrors?: ReadonlyArray<ts.Diagnostic | ts.DiagnosticWithLocation>;
} {
  const { compilerOptions, configDiagnostics } =
    resolveCompilerOptions(testFilePath);

  if (configDiagnostics.length !== 0) {
    return {
      tsdErrors: configDiagnostics,
      assertionCount: 0,
      tsdResults: [],
    };
  }

  const program = ts.createProgram([testFilePath], compilerOptions);
  const syntacticDiagnostics = program.getSyntacticDiagnostics();

  if (syntacticDiagnostics.length !== 0) {
    return {
      tsdErrors: syntacticDiagnostics,
      assertionCount: 0,
      tsdResults: [],
    };
  }

  const semanticDiagnostics = program.getSemanticDiagnostics();

  const typeChecker = program.getTypeChecker();
  const { assertions, assertionCount } = extractAssertions(program);

  const tsdResults = handleAssertions(typeChecker, assertions);

  const expectedErrors = parseErrorAssertionToLocation(assertions);
  const expectedErrorsLocationsWithFoundDiagnostics: Location[] = [];

  for (const diagnostic of semanticDiagnostics) {
    if (!isDiagnosticWithLocation(diagnostic)) {
      continue;
    }

    if (/[/\\]node_modules[/\\]/.test(diagnostic.file.fileName)) {
      continue;
    }

    const ignoreDiagnosticResult = isIgnoredDiagnostic(
      diagnostic,
      expectedErrors
    );

    if (ignoreDiagnosticResult !== "preserve") {
      if (ignoreDiagnosticResult !== "ignore") {
        expectedErrorsLocationsWithFoundDiagnostics.push(
          ignoreDiagnosticResult
        );
      }

      continue;
    }

    tsdResults.push(diagnostic);
  }

  for (const errorLocationToRemove of expectedErrorsLocationsWithFoundDiagnostics) {
    expectedErrors.delete(errorLocationToRemove);
  }

  for (const [, error] of expectedErrors) {
    tsdResults.push({
      ...error,
      messageText: "Expected an error, but found none.",
    });
  }

  return { assertionCount, tsdResults };
}
