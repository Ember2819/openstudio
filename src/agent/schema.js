// JSON Schema helpers for tool definitions, plus a small validator for the subset they use, so a wrong
// argument comes back to the agent as a clear message instead of a stack trace deep inside a tool.

export const str = (description, extra) => ({ type: 'string', description, ...extra });
export const num = (description, extra) => ({ type: 'number', description, ...extra });
export const int = (description, extra) => ({ type: 'integer', description, ...extra });
export const bool = (description, extra) => ({ type: 'boolean', description, ...extra });
export const choice = (values, description) => ({ type: 'string', enum: values, description });
export const arr = (items, description, extra) => ({ type: 'array', items, description, ...extra });
/** Strict object: unknown keys are rejected (they are almost always typos). */
export const obj = (properties, required = [], description) => ({
  type: 'object', properties, required, additionalProperties: false, ...(description ? { description } : {}),
});
export const maybe = (schema) => ({ ...schema, type: [].concat(schema.type, 'null') });

/** A channel, pattern, … referenced by numeric id or by (unique) name. */
export const ref = (what) => ({ type: ['integer', 'string'], description: `${what} id, or its name` });
export const COLOR = str('Colour as #rrggbb', { pattern: '^#[0-9a-fA-F]{6}$' });
export const PITCH = { type: ['integer', 'string'], description: 'MIDI number (0-119) or note name such as "C5", "F#4", "Bb3" (MIDI 60 = C5)' };

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const matches = (type, v) => (type === 'number' ? typeof v === 'number' && Number.isFinite(v) : type === 'integer' ? Number.isInteger(v) : typeOf(v) === type);

/** Returns an error message, or null when `value` satisfies `schema`. */
export function validate(schema, value, at = 'arguments') {
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => matches(t, value))) return `${at} must be ${types.join(' or ')} (got ${value === undefined ? 'nothing' : JSON.stringify(value)?.slice(0, 40)})`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${at} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')} (got ${JSON.stringify(value)})`;
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) return `${at} must be at least ${schema.minimum}`;
    if (schema.maximum != null && value > schema.maximum) return `${at} must be at most ${schema.maximum}`;
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) return `${at} has the wrong format (${schema.description || schema.pattern})`;
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) return `${at} needs at least ${schema.minItems} item(s)`;
    if (schema.maxItems != null && value.length > schema.maxItems) return `${at} takes at most ${schema.maxItems} item(s)`;
    if (schema.items) for (let i = 0; i < value.length; i++) { const e = validate(schema.items, value[i], `${at}[${i}]`); if (e) return e; }
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    for (const key of schema.required || []) if (value[key] === undefined) return `${at}.${key} is required`;
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties[key];
      if (!sub) {
        if (schema.additionalProperties === false) return `${at} has an unknown field "${key}" (allowed: ${Object.keys(schema.properties).join(', ')})`;
        continue;
      }
      const e = validate(sub, v, `${at}.${key}`);
      if (e) return e;
    }
  }
  return null;
}
