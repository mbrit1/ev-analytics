import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')

/** Test suite for explicit grants on every public domain table in the canonical schema. */
describe('canonical schema table grants', () => {
  it('grants authenticated CRUD on every declared public table and grants neither anon nor service_role', () => {
    // Arrange: Discover the canonical public tables from their CREATE TABLE declarations.
    const tables = [...schema.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi)]
      .map((match) => match[1])
    assert.ok(tables.length > 0, 'Canonical schema declares no public tables.')
    const grants = [...schema.matchAll(/\bGRANT\s+([^;]+?)\s+ON\s+TABLE\s+public\.([a-z_][a-z0-9_]*)\s+TO\s+([^;]+);/gi)]

    // Act: Normalize explicit grants while retaining the table and role they target.
    const grantsFor = (table, privilege, role) => grants.some(([, privileges, grantedTable, roles]) => (
      grantedTable === table
      && roles.split(',').some((grantee) => grantee.trim().toLowerCase() === role)
      && privileges.split(',').some((grantedPrivilege) => grantedPrivilege.trim().toUpperCase() === privilege)
    ))

    // Assert: Each canonical public table has explicit authenticated CRUD only.
    for (const table of tables) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.ok(grantsFor(table, privilege, 'authenticated'), `${table} lacks authenticated ${privilege} grant.`)
      }
      assert.ok(!grants.some(([, , grantedTable, roles]) => (
        grantedTable === table && roles.split(',').some((grantee) => ['anon', 'service_role'].includes(grantee.trim().toLowerCase()))
      )), `${table} grants privileges to anon or service_role.`)
    }
  })
})
