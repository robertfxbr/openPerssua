// Validação básica e recursiva; não substitui um validador JSON Schema completo.
function validateArguments(schema, value, path = 'argumentos', depth = 0) {
  if (depth > 20) throw new Error('Schema profundo demais');
  if (!schema || typeof schema !== 'object') throw new Error('Schema inválido');
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const matches = type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
    : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : type === 'integer' ? Number.isInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
  if (types.length && !types.some(matches)) throw new Error(`${path}: tipo inválido (${types.join('/')})`);
  if (schema.enum && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) throw new Error(`${path}: valor não permitido`);
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const name of schema.required || []) if (!Object.hasOwn(value, name)) throw new Error(`${path}.${name}: obrigatório`);
    for (const [name, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Chave não permitida');
      if (Object.hasOwn(schema.properties || {}, name)) validateArguments(schema.properties[name], child, `${path}.${name}`, depth + 1);
      else if (schema.additionalProperties === false) throw new Error(`${path}.${name}: não permitido`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => validateArguments(schema.items, v, `${path}[${i}]`, depth + 1));
}
module.exports = { validateArguments };
