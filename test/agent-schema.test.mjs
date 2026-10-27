import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, obj, int, str, num, arr, choice, maybe } from '../src/agent/schema.js';
import { parsePitch } from '../src/agent/helpers.js';
import { TOOLS, describeTools } from '../src/agent/index.js';

test('validator checks types, ranges, enums, required and unknown fields', () => {
  const schema = obj({ a: int('a', { minimum: 1, maximum: 3 }), b: choice(['x', 'y'], 'b'), c: arr(num('n'), 'c', { minItems: 1 }), d: maybe(str('d')) }, ['a']);
  assert.equal(validate(schema, { a: 2, b: 'x', c: [1.5], d: null }), null);
  assert.match(validate(schema, {}), /a is required/);
  assert.match(validate(schema, { a: 4 }), /at most 3/);
  assert.match(validate(schema, { a: 1.5 }), /must be integer/);
  assert.match(validate(schema, { a: 1, b: 'z' }), /one of "x", "y"/);
  assert.match(validate(schema, { a: 1, c: [] }), /at least 1/);
  assert.match(validate(schema, { a: 1, c: ['q'] }), /arguments\.c\[0\] must be number/);
  assert.match(validate(schema, { a: 1, typo: 1 }), /unknown field "typo"/);
  assert.match(validate(schema, 5), /must be object/);
});

test('pitches accept numbers and FL-style note names (MIDI 60 = C5)', () => {
  assert.equal(parsePitch(60), 60);
  assert.equal(parsePitch('60'), 60);
  assert.equal(parsePitch('C5'), 60);
  assert.equal(parsePitch('c5'), 60);
  assert.equal(parsePitch('A4'), 57);
  assert.equal(parsePitch('F#4'), 54);
  assert.equal(parsePitch('Bb3'), 46);
  assert.equal(parsePitch('C0'), 0);
  assert.equal(parsePitch('B9'), 119);
  assert.throws(() => parsePitch('H3'), /not a pitch/);
  assert.throws(() => parsePitch(120), /outside/);
  assert.throws(() => parsePitch(-1), /outside/);
});

test('every tool is well formed', () => {
  const names = new Set();
  for (const t of describeTools()) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, t.name);
    assert.ok(!names.has(t.name), `duplicate tool ${t.name}`);
    names.add(t.name);
    assert.ok(t.description.length > 30, `${t.name} needs a real description`);
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.ok(t.annotations && typeof t.annotations.readOnlyHint === 'boolean', `${t.name} needs annotations`);
  }
  assert.equal(TOOLS.length, names.size);
  // the JSON must survive a round trip: it is sent to clients as is
  assert.deepEqual(JSON.parse(JSON.stringify(describeTools())), describeTools());
});

test('docs/AGENTS.md documents every tool', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = readFileSync(new URL('../docs/AGENTS.md', import.meta.url), 'utf8');
  const missing = [...describeTools().map((t) => t.name), 'screenshot'].filter((name) => !doc.includes(`\`${name}\``));
  assert.deepEqual(missing, []);
});
