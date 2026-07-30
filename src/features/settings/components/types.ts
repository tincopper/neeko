/**
 * Shared prop types for SchemaField components.
 */

import type { JsonSchema } from '@/lib/schemaValidator';

export interface BaseFieldProps {
  /** JSON pointer path for this field. */
  path: string;
  /** JSON Schema for this field. */
  schema: JsonSchema;
  /** Current value. */
  value?: unknown;
  /** Whether this field is required. */
  required?: boolean;
  /** Validation error message, if any. */
  error?: string;
  /** Whether the field is read-only. */
  readOnly?: boolean;
}
