// Local-preview only: turn the Prisma schema into Postgres DDL.
//
// The Prisma CLI generates DDL with its schema-engine binary, which a sandbox
// without network access cannot download. The local preview does not need
// Prisma's full migration planner, only "make the database match this schema",
// so the statements are derived straight from Prisma's own parsed schema (the
// DMMF). Production still uses `prisma db push` and never touches this file.
//
// Scope: tables, columns, primary keys, unique constraints and foreign keys.
// Non-unique indexes are skipped; they only matter for performance, and the
// preview database holds a handful of rows.

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Prisma's schema parser, compiled to wasm and shipped on npm. */
export function parseSchema(schemaText) {
  globalThis.PRISMA_WASM_PANIC_REGISTRY ??= { set_message() {}, take_message: () => null };
  const wasm = require('@prisma/prisma-schema-wasm/src/prisma_schema_build.js');
  // The parser insists on a datasource url; the value is never used here.
  const text = schemaText.replace(/env\(\s*"[^"]*"\s*\)/g, '"postgresql://preview"');
  const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: text, previewFeatures: [] })));
  return dmmf.datamodel;
}

const TYPES = {
  String: 'TEXT',
  Boolean: 'BOOLEAN',
  Int: 'INTEGER',
  BigInt: 'BIGINT',
  Float: 'DOUBLE PRECISION',
  Decimal: 'DECIMAL(65,30)',
  DateTime: 'TIMESTAMP(3)',
  Json: 'JSONB',
  Bytes: 'BYTEA',
};

function sqlType(field) {
  const base = TYPES[field.type];
  if (!base) throw new Error(`preview/ddl: unsupported field type ${field.type} (${field.name})`);
  return field.isList ? `${base}[]` : base;
}

// @@index is not part of the DMMF, so indexes come from the schema text.
function indexNames(schemaText) {
  const found = new Set();
  const re = /@@index\(\[([^\]]+)\](?:,\s*map:\s*"([^"]+)")?\)/g;
  let match;
  while ((match = re.exec(schemaText))) found.add(match[2] || null);
  return found.size;
}

function defaultValue(field) {
  const value = field.default;
  if (!value) return '';
  // cuid(), uuid(), nanoid() and autoincrement() are produced by the client or
  // by the column type; none of them are a SQL default here.
  if (['cuid', 'uuid', 'nanoid', 'autoincrement', 'ulid'].includes(value.name)) return '';
  if (value.name === 'now') return ' DEFAULT CURRENT_TIMESTAMP';
  if (typeof value === 'boolean') return ` DEFAULT ${value}`;
  if (typeof value === 'number') return ` DEFAULT ${value}`;
  if (typeof value === 'string') return ` DEFAULT '${value.replace(/'/g, "''")}'`;
  if (value.name === 'dbgenerated') return '';
  return '';
}

/** Tables before the tables they reference. */
function sortModels(models) {
  const done = new Set();
  const ordered = [];
  const visit = (model, stack = new Set()) => {
    if (done.has(model.name) || stack.has(model.name)) return;
    stack.add(model.name);
    for (const field of model.fields) {
      const target = field.kind === 'object' && field.relationFromFields?.length
        ? models.find((m) => m.name === field.type)
        : null;
      if (target) visit(target, stack);
    }
    done.add(model.name);
    ordered.push(model);
  };
  models.forEach((model) => visit(model));
  return ordered;
}

/**
 * Returns the statements that make an empty database match the schema.
 * Every statement is safe to run twice.
 */
export function ddlFor(datamodel, schemaText = '') {
  const models = sortModels(datamodel.models);
  const statements = [];

  for (const model of models) {
    const columns = [];
    const constraints = [];

    for (const field of model.fields) {
      if (field.kind !== 'scalar') continue;
      columns.push(`  "${field.name}" ${sqlType(field)}${field.isRequired ? ' NOT NULL' : ''}${defaultValue(field)}`);
    }

    const id = model.fields.find((f) => f.isId);
    if (model.primaryKey) {
      const fields = model.primaryKey.fields.map((f) => `"${f}"`).join(', ');
      constraints.push(`  CONSTRAINT "${model.name}_pkey" PRIMARY KEY (${fields})`);
    } else if (id) {
      constraints.push(`  CONSTRAINT "${model.name}_pkey" PRIMARY KEY ("${id.name}")`);
    }

    for (const field of model.fields) {
      if (field.kind === 'scalar' && field.isUnique) {
        constraints.push(`  CONSTRAINT "${model.name}_${field.name}_key" UNIQUE ("${field.name}")`);
      }
    }
    for (const unique of model.uniqueIndexes || []) {
      const fields = unique.fields.map((f) => `"${f}"`).join(', ');
      constraints.push(`  CONSTRAINT "${model.name}_${unique.fields.join('_')}_key" UNIQUE (${fields})`);
    }

    for (const field of model.fields) {
      if (field.kind !== 'object' || !field.relationFromFields?.length) continue;
      const from = field.relationFromFields.map((f) => `"${f}"`).join(', ');
      const to = field.relationToFields.map((f) => `"${f}"`).join(', ');
      const onDelete = field.relationOnDelete === 'Cascade' ? ' ON DELETE CASCADE'
        : field.relationOnDelete === 'SetNull' ? ' ON DELETE SET NULL'
        : '';
      constraints.push(
        `  CONSTRAINT "${model.name}_${field.relationFromFields.join('_')}_fkey" ` +
        `FOREIGN KEY (${from}) REFERENCES "${field.type}" (${to})${onDelete} ON UPDATE CASCADE`
      );
    }

    statements.push(`CREATE TABLE IF NOT EXISTS "${model.name}" (\n${[...columns, ...constraints].join(',\n')}\n);`);

    // Adding a column to an existing local database: keep it additive, and
    // allow null so a re-run never fails on a table that already has rows.
    for (const field of model.fields) {
      if (field.kind !== 'scalar') continue;
      statements.push(
        `ALTER TABLE "${model.name}" ADD COLUMN IF NOT EXISTS "${field.name}" ${sqlType(field)};`
      );
    }
  }

  return statements;
}

export function readSchema(path) {
  return fs.readFileSync(path, 'utf8');
}

export { indexNames };
