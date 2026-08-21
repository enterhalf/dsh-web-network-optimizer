// dsh-web-optimizer 客户端构建:浏览器 bundle 为单文件 IIFE(__ModuleLoader__),
// 无本地 import,直接拷贝 + 语法自检。
import { copyFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'lib'), { recursive: true })
copyFileSync(join(root, 'src', 'client', 'index.js'), join(root, 'lib', 'client.js'))
execFileSync(process.execPath, ['--check', join(root, 'lib', 'client.js')], { stdio: 'inherit' })
console.log('=== dsh-web-optimizer client build complete ===')
