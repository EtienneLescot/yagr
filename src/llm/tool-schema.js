function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function appendNullToType(type) {
    if (typeof type === 'string') {
        return type === 'null' ? 'null' : [type, 'null'];
    }
    if (Array.isArray(type)) {
        return type.includes('null') ? type : [...type, 'null'];
    }
    return ['null'];
}
function makeSchemaNullable(schema) {
    if (schema.type !== undefined) {
        return {
            ...schema,
            type: appendNullToType(schema.type),
        };
    }
    if (Array.isArray(schema.anyOf)) {
        const hasNull = schema.anyOf.some((entry) => isRecord(entry) && entry.type === 'null');
        if (!hasNull) {
            return {
                ...schema,
                anyOf: [...schema.anyOf, { type: 'null' }],
            };
        }
    }
    if (Array.isArray(schema.oneOf)) {
        const hasNull = schema.oneOf.some((entry) => isRecord(entry) && entry.type === 'null');
        if (!hasNull) {
            return {
                ...schema,
                oneOf: [...schema.oneOf, { type: 'null' }],
            };
        }
    }
    return {
        anyOf: [schema, { type: 'null' }],
    };
}
function normalizeSchemaNode(schema, forceRequired) {
    if (!isRecord(schema)) {
        return schema;
    }
    const normalized = { ...schema };
    if (Array.isArray(schema.anyOf)) {
        normalized.anyOf = schema.anyOf.map((entry) => normalizeSchemaNode(entry, forceRequired));
    }
    if (Array.isArray(schema.oneOf)) {
        normalized.oneOf = schema.oneOf.map((entry) => normalizeSchemaNode(entry, forceRequired));
    }
    if (isRecord(schema.items)) {
        normalized.items = normalizeSchemaNode(schema.items, forceRequired);
    }
    if (isRecord(schema.properties)) {
        const properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, normalizeSchemaNode(value, forceRequired)]));
        const propertyKeys = Object.keys(properties);
        const originalRequired = new Set(Array.isArray(schema.required)
            ? schema.required.filter((entry) => typeof entry === 'string')
            : []);
        if (forceRequired) {
            for (const key of propertyKeys) {
                if (!originalRequired.has(key) && isRecord(properties[key])) {
                    properties[key] = makeSchemaNullable(properties[key]);
                }
            }
        }
        normalized.properties = properties;
        normalized.required = forceRequired ? propertyKeys : [...originalRequired];
        if (normalized.additionalProperties === undefined) {
            normalized.additionalProperties = false;
        }
    }
    return normalized;
}
export function normalizeFunctionToolParametersSchema(schema, options = {}) {
    return normalizeSchemaNode(schema, options.forceRequiredObjectProperties === true);
}
//# sourceMappingURL=tool-schema.js.map