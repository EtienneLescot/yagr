import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const targets = [
  'dist',
  'tsconfig.tsbuildinfo',
  join('node_modules', '.cache'),
  ...readdirSync('packages', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join('packages', entry.name, 'dist')),
]

for (const target of targets) {
  rmSync(target, { recursive: true, force: true })
}
