import assert from "node:assert/strict";
import { test } from "node:test";
import { asTable } from "../src/mcp.js";

test("MCP sends a list of records as {columns, rows}, keys once, null for a missing field", () => {
  const data = [
    { airline: ["JetBlue"], price: 209, via: ["BOS"] },
    { airline: ["Delta"], price: 219 },
    { airline: ["United"], price: 229 },
  ];
  assert.deepEqual(asTable(data), {
    columns: ["airline", "price", "via"],
    rows: [
      [["JetBlue"], 209, ["BOS"]],
      [["Delta"], 219, null],
      [["United"], 229, null],
    ],
  });
});

test("MCP sends anything that is not a list of two or more records unchanged", () => {
  for (const data of [[{ a: 1 }], [], [1, 2], [[1], [2]], [{ a: 1 }, null], { a: 1 }, "text", null, undefined]) {
    assert.deepEqual(asTable(data), data);
  }
});

test("MCP keeps sparse records within the original answer's size instead of allocating missing cells", () => {
  const data = Array.from({ length: 1000 }, (_, i) => ({ [`k${i}`]: i }));
  const result = asTable(data);
  assert.equal(result, data);
  assert.equal(JSON.stringify(result).length, JSON.stringify(data).length);
});

test("MCP keeps small records when the table envelope would grow the answer", () => {
  for (const data of [
    [{ a: 1 }, { a: 2 }],
    [{}, {}],
    [{ a: 1 }, { b: 2 }],
  ])
    assert.equal(asTable(data), data);
});
