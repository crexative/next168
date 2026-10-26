import { execFile } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('replaces a stale CLI with the source banner through the install lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'next168-build-'))
  const companion = join(root, 'companion')
  try {
    await mkdir(join(companion, 'dist'), { recursive: true })
    for (const file of ['package.json', 'build.mjs', 'tsconfig.json', 'src']) await cp(resolve(file), join(companion, file), { recursive: true })
    await cp(resolve('../tsconfig.node.json'), join(root, 'tsconfig.node.json'))
    await symlink(resolve('../src'), join(root, 'src'), 'dir')
    await symlink(resolve('../node_modules'), join(root, 'node_modules'), 'dir')
    await symlink(resolve('node_modules'), join(companion, 'node_modules'), 'dir')
    await writeFile(join(companion, 'dist/cli.js'), 'console.log("Next168 companion")\n')
    await promisify(execFile)('npm', ['run', 'prepare'], { cwd: companion })
    const source = await readFile(resolve('src/cli.ts'), 'utf8')
    const banner = source.match(/console\.log\(`([^`\n]+ companion:)/)?.[1]
    expect(banner).toBeTruthy()
    expect(await readFile(join(companion, 'dist/cli.js'), 'utf8')).toContain(banner)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30_000)
