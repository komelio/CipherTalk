const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../src')
const lucide = require('lucide-react')
const exported = new Set(Object.keys(lucide))

const files = []
const walk = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walk(p)
      continue
    }
    if (/\.(ts|tsx)$/.test(ent.name)) {
      files.push(p)
    }
  }
}

walk(root)

const missing = []
const importRegex = /import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  let match
  while ((match = importRegex.exec(text))) {
    const names = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim())
    for (const name of names) {
      if (!exported.has(name)) {
        missing.push({ file, name })
      }
    }
  }
}

if (missing.length === 0) {
  console.log('ALL_OK')
  process.exit(0)
}

for (const item of missing) {
  console.log(`${item.name} :: ${item.file}`)
}
process.exit(1)
