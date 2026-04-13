import { describe, test, expect } from "vitest";
import * as core from "./index";

describe("runtime barrel — Invariant 14 (purely additive)", () => {
  // Names that existed BEFORE the runtime module landed. If any of these
  // disappears, the addition stopped being purely additive and a downstream
  // package will break. Update only when intentionally removing/renaming.
  const PREEXISTING_VALUE_EXPORTS = [
    "DynamicValueSchema",
    "DynamicStringSchema",
    "DynamicNumberSchema",
    "DynamicBooleanSchema",
    "resolveDynamicValue",
    "getByPath",
    "setByPath",
    "VisibilityConditionSchema",
    "LogicExpressionSchema",
    "evaluateVisibility",
    "evaluateLogicExpression",
    "visibility",
    "ActionSchema",
    "ActionConfirmSchema",
    "ActionOnSuccessSchema",
    "ActionOnErrorSchema",
    "resolveAction",
    "executeAction",
    "interpolateString",
    "action",
    "ValidationCheckSchema",
    "ValidationConfigSchema",
    "builtInValidationFunctions",
    "runValidationCheck",
    "runValidation",
    "check",
    "createCatalog",
    "generateCatalogPrompt",
  ] as const;

  for (const name of PREEXISTING_VALUE_EXPORTS) {
    test(`pre-existing export "${name}" is still defined`, () => {
      expect((core as Record<string, unknown>)[name]).toBeDefined();
    });
  }

  test("the four new value exports are defined", () => {
    expect(core.createStagingBuffer).toBeDefined();
    expect(core.createObservableDataModel).toBeDefined();
    expect(core.validateJSONValue).toBeDefined();
    expect(core.InitialDataNotSerializableError).toBeDefined();
  });
});

describe("runtime barrel — Invariant 15 (IntentEvent shape)", () => {
  test("IntentEvent satisfies the spec's required field shape", () => {
    // Compile-time check via type assignment + runtime construction. If any
    // required field is renamed or its type tightened, this file fails to
    // typecheck — that's the assertion. The runtime expect is a sanity check.
    const event: core.IntentEvent = {
      action_name: "submit",
      action_params: {
        foo: "bar",
        n: 42,
        ok: true,
        list: [1, 2, 3],
        nested: { k: "v" },
      },
      staging_snapshot: { email: "x@y.z", agree: true },
      catalog_version: "v1.2.3",
      timestamp: Date.now(),
    };
    expect(event.action_name).toBe("submit");
    expect(event.staging_snapshot).toEqual({ email: "x@y.z", agree: true });
    expect(typeof event.timestamp).toBe("number");
  });
});
