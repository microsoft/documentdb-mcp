/*---------------------------------------------------------------------------------------------
 *  Generic parameter parsing helpers for MCP tools.
 *  These functions allow accepting loose string inputs and coercing them into the expected
 *  runtime types (object, array, number, boolean) with clear error messages.
 *--------------------------------------------------------------------------------------------*/

export type ExpectedType = 'object' | 'array' | 'number' | 'int' | 'boolean' | 'string' | 'any';

export interface ParseOptions {
  allowEmptyStringAsNull?: boolean;      // Treat '' as null -> then apply default
  defaultValue?: any;                    // Fallback when value is undefined/null/'' (if policy allows)
  fieldName?: string;                    // For clearer error messages
  nonNegative?: boolean;                 // For number/int
  integer?: boolean;                     // Force integer (alias: using 'int' expectedType also sets this)
  maxStringLength?: number;              // Optional guard rail
}

export interface ParseResult<T = any> {
  value: T;
  errors?: string[]; // Collected errors (if in tolerant mode we could continue; currently we stop on first)
}

/** Core parsing logic. */
export function parseParam<T = any>(raw: any, expected: ExpectedType, options: ParseOptions = {}): ParseResult<T> {
  const {
    allowEmptyStringAsNull = true,
    defaultValue,
    fieldName = 'value',
    nonNegative = false,
    integer = expected === 'int',
    maxStringLength
  } = options;

  // Handle undefined/null/empty
  if (raw === undefined || raw === null || (allowEmptyStringAsNull && raw === '')) {
    if (defaultValue !== undefined) {
      return { value: defaultValue as T };
    }
    // Provide a sensible zero value depending on expected type
    switch (expected) {
      case 'object': return { value: {} as T };
      case 'array': return { value: [] as T };
      case 'number':
      case 'int': return { value: 0 as T };
      case 'boolean': return { value: false as T };
      case 'string': return { value: '' as T };
      case 'any': default: return { value: raw as T };
    }
  }

  // Early length guard
  if (typeof raw === 'string' && maxStringLength && raw.length > maxStringLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxStringLength}`);
  }

  // Dispatch per expected type
  switch (expected) {
    case 'string': {
      if (typeof raw === 'string') return { value: raw as T };
      return { value: String(raw) as T };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw as T };
      if (typeof raw === 'string') {
        const lower = raw.trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(lower)) return { value: true as T };
        if (['false', '0', 'no', 'n'].includes(lower)) return { value: false as T };
        throw new Error(`${fieldName} must be a boolean (true/false/1/0/yes/no)`);
      }
      if (typeof raw === 'number') return { value: (raw !== 0) as T };
      throw new Error(`${fieldName} must be a boolean`);
    }
    case 'number':
    case 'int': {
      let num: number;
      if (typeof raw === 'number') {
        num = raw;
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) throw new Error(`${fieldName} must be a number`);
        num = Number(trimmed);
      } else {
        throw new Error(`${fieldName} must be a number`);
      }
      if (!Number.isFinite(num)) throw new Error(`${fieldName} must be a finite number`);
      if (integer && !Number.isInteger(num)) throw new Error(`${fieldName} must be an integer`);
      if (nonNegative && num < 0) throw new Error(`${fieldName} must be non-negative`);
      return { value: num as T };
    }
    case 'object': {
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return { value: raw as T };
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${fieldName} must be a JSON object`);
          }
          return { value: parsed as T };
        } catch (e) {
          throw new Error(`${fieldName} invalid JSON object: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      throw new Error(`${fieldName} must be an object`);
    }
    case 'array': {
      if (Array.isArray(raw)) return { value: raw as T };
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error(`${fieldName} must be a JSON array`);
          return { value: parsed as T };
        } catch (e) {
          throw new Error(`${fieldName} invalid JSON array: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      throw new Error(`${fieldName} must be an array`);
    }
    case 'any': default:
      return { value: raw as T };
  }
}

/** Specialized helper for MongoDB update documents. */
export function parseUpdate(raw: any, options: ParseOptions = {}): ParseResult<Record<string, any>> {
  const { value } = parseParam<Record<string, any>>(raw, 'object', { fieldName: options.fieldName || 'update' });
  // Per latest requirement: no validation of $ operators, just ensure it's an object.
  return { value };
}

/** Convenience aggregator for multiple fields. */
export function parseParams(spec: Array<{ raw: any; expected: ExpectedType; options?: ParseOptions; outKey: string; }>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const item of spec) {
    const { value } = parseParam(item.raw, item.expected, { ...item.options, fieldName: item.options?.fieldName || item.outKey });
    result[item.outKey] = value;
  }
  return result;
}
