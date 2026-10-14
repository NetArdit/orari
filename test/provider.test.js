import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProvider } from "../lib/ai.js";

test("OpenRouter is the default and keeps the free-only rule", () => {
    const p = resolveProvider({ OPENROUTER_API_KEY: "k" });
    assert.equal(p.name, "openrouter");
    assert.equal(p.baseURL, "https://openrouter.ai/api/v1");
    assert.equal(p.models.every((m) => m.endsWith(":free")), true);
    assert.throws(() => resolveProvider({ OPENROUTER_MODELS: "openai/gpt-4o" }));
});

test("Groq uses its own address, key name and models", () => {
    const p = resolveProvider({ AI_PROVIDER: "groq", GROQ_API_KEY: "k" });
    assert.equal(p.name, "groq");
    assert.equal(p.baseURL, "https://api.groq.com/openai/v1");
    assert.equal(p.keyName, "GROQ_API_KEY");
    assert.equal(p.apiKey, "k");
    assert.deepEqual(resolveProvider({ AI_PROVIDER: "groq", GROQ_MODELS: "a-model, b-model" }).models, ["a-model", "b-model"]);
});

test("a wrong provider or model list is a mistake in the settings", () => {
    assert.throws(() => resolveProvider({ AI_PROVIDER: "other" }));
    assert.throws(() => resolveProvider({ AI_PROVIDER: "groq", GROQ_MODELS: "x,x" }));
    assert.throws(() => resolveProvider({ AI_PROVIDER: "groq", GROQ_MODELS: "bad id with spaces" }));
});
