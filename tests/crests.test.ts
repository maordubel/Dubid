import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { teamLogo } from '../src/data/teamLogos.ts'
import { LOGO_MAP } from '../ecosystem/crests/index.mjs'

// One crest library for the universe (owner, 26.10.2026): every DUBID crest is a file of OFFSIDES' library, by its slug.
test('every DUBID crest is a crest of the shared library', () => {
  const library = new Set(Object.values(LOGO_MAP))
  for (let i = 1; i <= 14; i++) {
    const path = teamLogo(`T${i}`)
    if (!path) continue
    const slug = path.replace(/^\/logos\//, '').replace(/\.png$/, '')
    assert.ok(library.has(slug), `T${i} → ${slug} is not in ecosystem/crests`)
    assert.ok(existsSync(`public${path}`), `public${path} is missing`)
  }
})
