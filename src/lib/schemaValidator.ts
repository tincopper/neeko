/**
 * Lightweight JSON Schema validation utility for Agent configuration.
 *
 * Mirrors the backend `schema_validator.rs` for real-time frontend validation
 * without an IPC round-trip. Supports the Draft-07 subset used by the
 * AgentPlugin schemas: string, number, integer, boolean, object, array,
 * enum, format, required, default, min/max, minLength/maxLength.
 */

export interface ValidationError {
  path: string;
  message: string;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: JsonValue[];
  default?: JsonValue;
  description?: string;
  format?: string;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: JsonSchema | boolean;
}

/**
 * Validate a config value against a JSON Schema.
 * Returns { valid: true, value } with defaults applied, or { valid: false, errors }.
 */
export function validateConfig(
  schema: JsonSchema,
  config: JsonValue,
): { valid: true; value: JsonValue } | { valid: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const result = structuredClone(config);

  validateValue(schema, result, '', errors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  applyDefaults(schema, result);
  return { valid: true, value: result };
}

function validateValue(
  schema: JsonSchema,
  value: JsonValue,
  path: string,
  errors: ValidationError[],
): void {
  // Enum check
  if (schema.enum && schema.enum.length > 0) {
    if (!schema.enum.some((e) => deepEqual(e, value))) {
      errors.push({
        path,
        message: `Must be one of: ${schema.enum.map((v) => String(v)).join(', ')}`,
      });
      return;
    }
  }

  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push({ path, message: 'Expected an object' });
        return;
      }
      validateObject(schema, value as Record<string, JsonValue>, path, errors);
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push({ path, message: 'Expected an array' });
        return;
      }
      validateArray(schema, value, path, errors);
      break;
    }
    case 'string': {
      if (typeof value !== 'string') {
        errors.push({ path, message: 'Expected a string' });
        return;
      }
      validateString(schema, value, path, errors);
      break;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push({ path, message: 'Expected an integer' });
        return;
      }
      validateNumber(schema, value, path, errors);
      break;
    }
    case 'number': {
      if (typeof value !== 'number') {
        errors.push({ path, message: 'Expected a number' });
        return;
      }
      validateNumber(schema, value, path, errors);
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        errors.push({ path, message: 'Expected a boolean' });
      }
      break;
    }
  }
}

function validateObject(
  schema: JsonSchema,
  obj: Record<string, JsonValue>,
  path: string,
  errors: ValidationError[],
): void {
  // Required
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in obj)) {
        errors.push({
          path: path ? `${path}/${key}` : key,
          message: 'This field is required',
        });
      }
    }
  }

  // Properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        validateValue(propSchema, obj[key], path ? `${path}/${key}` : key, errors);
      }
    }
  }

  // Additional properties
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === 'object' &&
    schema.properties
  ) {
    for (const [key, val] of Object.entries(obj)) {
      if (!(key in schema.properties)) {
        validateValue(schema.additionalProperties, val, path ? `${path}/${key}` : key, errors);
      }
    }
  }
}

function validateArray(
  schema: JsonSchema,
  arr: JsonValue[],
  path: string,
  errors: ValidationError[],
): void {
  if (schema.minItems != null && arr.length < schema.minItems) {
    errors.push({ path, message: `At least ${schema.minItems} items required` });
  }
  if (schema.maxItems != null && arr.length > schema.maxItems) {
    errors.push({ path, message: `At most ${schema.maxItems} items allowed` });
  }
  if (schema.items) {
    arr.forEach((item, i) => {
      validateValue(schema.items!, item, `${path}/${i}`, errors);
    });
  }
}

function validateString(
  schema: JsonSchema,
  s: string,
  path: string,
  errors: ValidationError[],
): void {
  if (schema.minLength != null && s.length < schema.minLength) {
    errors.push({ path, message: `Minimum length is ${schema.minLength}` });
  }
  if (schema.maxLength != null && s.length > schema.maxLength) {
    errors.push({ path, message: `Maximum length is ${schema.maxLength}` });
  }
  if (schema.pattern) {
    try {
      const re = new RegExp(schema.pattern);
      if (!re.test(s)) {
        errors.push({ path, message: `Must match pattern: ${schema.pattern}` });
      }
    } catch {
      // Invalid regex — skip
    }
  }
  if (schema.format) {
    validateFormat(s, schema.format, path, errors);
  }
}

function validateNumber(
  schema: JsonSchema,
  n: number,
  path: string,
  errors: ValidationError[],
): void {
  if (schema.minimum != null && n < schema.minimum) {
    errors.push({ path, message: `Minimum value is ${schema.minimum}` });
  }
  if (schema.maximum != null && n > schema.maximum) {
    errors.push({ path, message: `Maximum value is ${schema.maximum}` });
  }
}

function validateFormat(s: string, format: string, path: string, errors: ValidationError[]): void {
  switch (format) {
    case 'url':
      if (!/^https?:\/\//.test(s) && !/^wss?:\/\//.test(s)) {
        errors.push({
          path,
          message: 'Must be a valid URL (http://, https://, ws://, wss://)',
        });
      }
      break;
    case 'uri':
      if (!s.includes('://') && !s.startsWith('/')) {
        errors.push({ path, message: 'Must be a valid URI' });
      }
      break;
  }
}

function applyDefaults(schema: JsonSchema, value: JsonValue): void {
  if (
    schema.type !== 'object' ||
    !schema.properties ||
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return;
  }
  const obj = value as Record<string, JsonValue>;
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (!(key in obj) && 'default' in propSchema) {
      obj[key] = structuredClone(propSchema.default!);
    } else if (propSchema.type === 'object' && key in obj) {
      applyDefaults(propSchema, obj[key]);
    }
  }
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every(
        (k) =>
          k in b &&
          deepEqual((a as Record<string, JsonValue>)[k], (b as Record<string, JsonValue>)[k]),
      )
    );
  }
  return false;
}
