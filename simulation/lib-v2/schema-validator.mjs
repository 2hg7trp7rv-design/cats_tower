export class SchemaValidationError extends Error {
  constructor(errors) {
    super(`JSON Schema validation failed with ${errors.length} error(s)`);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

function typeMatches(value, type) {
  switch (type) {
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    default: return false;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Only local JSON Pointer refs are supported: ${ref}`);
  return ref.slice(2).split('/').reduce((node, raw) => {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === undefined || node === null || !(key in node)) throw new Error(`Unresolvable $ref: ${ref}`);
    return node[key];
  }, root);
}

export function validateSchema(instance, schema, { failFast = false } = {}) {
  const errors = [];
  const add = (path, keyword, message) => {
    errors.push({ path, keyword, message });
    return failFast;
  };

  function visit(value, rule, path, root) {
    if (rule === true) return false;
    if (rule === false) return add(path, 'falseSchema', 'value is forbidden');
    if (!rule || typeof rule !== 'object') return add(path, 'schema', 'invalid schema node');

    if (rule.$ref) return visit(value, resolveRef(root, rule.$ref), path, root);
    if (rule.allOf) for (const child of rule.allOf) if (visit(value, child, path, root) && failFast) return true;
    if (rule.anyOf) {
      const branches = rule.anyOf.map((child) => validateSchema(value, child).length === 0);
      if (!branches.some(Boolean) && add(path, 'anyOf', 'no branch matched')) return true;
    }
    if (rule.oneOf) {
      const count = rule.oneOf.filter((child) => validateSchema(value, child).length === 0).length;
      if (count !== 1 && add(path, 'oneOf', `expected exactly one matching branch, got ${count}`)) return true;
    }
    if (Object.prototype.hasOwnProperty.call(rule, 'const') && !deepEqual(value, rule.const)) {
      if (add(path, 'const', `expected ${JSON.stringify(rule.const)}`)) return true;
    }
    if (rule.enum && !rule.enum.some((x) => deepEqual(x, value))) {
      if (add(path, 'enum', `value is not in enum`)) return true;
    }

    if (rule.type) {
      const allowed = Array.isArray(rule.type) ? rule.type : [rule.type];
      if (!allowed.some((t) => typeMatches(value, t))) {
        if (add(path, 'type', `expected ${allowed.join('|')}`)) return true;
        return false;
      }
    }

    if (typeof value === 'string') {
      if (rule.minLength !== undefined && [...value].length < rule.minLength && add(path, 'minLength', `minimum ${rule.minLength}`)) return true;
      if (rule.maxLength !== undefined && [...value].length > rule.maxLength && add(path, 'maxLength', `maximum ${rule.maxLength}`)) return true;
      if (rule.pattern !== undefined && !(new RegExp(rule.pattern, rule.patternFlags ?? '')).test(value) && add(path, 'pattern', `does not match ${rule.pattern}`)) return true;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value) && add(path, 'finite', 'number must be finite')) return true;
      if (rule.minimum !== undefined && value < rule.minimum && add(path, 'minimum', `minimum ${rule.minimum}`)) return true;
      if (rule.maximum !== undefined && value > rule.maximum && add(path, 'maximum', `maximum ${rule.maximum}`)) return true;
      if (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum && add(path, 'exclusiveMinimum', `must exceed ${rule.exclusiveMinimum}`)) return true;
      if (rule.exclusiveMaximum !== undefined && value >= rule.exclusiveMaximum && add(path, 'exclusiveMaximum', `must be below ${rule.exclusiveMaximum}`)) return true;
    }

    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems && add(path, 'minItems', `minimum ${rule.minItems}`)) return true;
      if (rule.maxItems !== undefined && value.length > rule.maxItems && add(path, 'maxItems', `maximum ${rule.maxItems}`)) return true;
      if (rule.uniqueItems) {
        const seen = new Set(value.map((x) => JSON.stringify(x)));
        if (seen.size !== value.length && add(path, 'uniqueItems', 'array entries must be unique')) return true;
      }
      if (rule.items) {
        for (let i = 0; i < value.length; i += 1) if (visit(value[i], rule.items, `${path}/${i}`, root) && failFast) return true;
      }
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const props = rule.properties ?? {};
      for (const key of rule.required ?? []) {
        if (!Object.prototype.hasOwnProperty.call(value, key) && add(path, 'required', `missing property ${key}`)) return true;
      }
      for (const [key, child] of Object.entries(value)) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
          if (visit(child, props[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, root) && failFast) return true;
        } else if (rule.additionalProperties === false) {
          if (add(path, 'additionalProperties', `unknown property ${key}`)) return true;
        } else if (rule.additionalProperties && typeof rule.additionalProperties === 'object') {
          if (visit(child, rule.additionalProperties, `${path}/${key}`, root) && failFast) return true;
        }
      }
    }
    return false;
  }

  visit(instance, schema, '#', schema);
  return errors;
}

export function assertSchema(instance, schema, options) {
  const errors = validateSchema(instance, schema, options);
  if (errors.length) throw new SchemaValidationError(errors);
}
