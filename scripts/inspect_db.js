const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const documentsPath = require('os').homedir() + '\\Documents\\CipherTalkData';

function inspectSchema(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log(`DB not found: ${dbPath}`);
    return;
  }
  const db = new Database(dbPath, { readonly: true });
  console.log(`\n--- Schema for ${path.basename(dbPath)} ---`);
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  for (const table of tables) {
    if (table.name.toLowerCase() === 'sessiontable' || table.name.toLowerCase() === 'contact' || table.name.toLowerCase() === 'bizinfo') {
      const cols = db.prepare(`PRAGMA table_info("${table.name}")`).all();
      console.log(`Table: ${table.name}`);
      console.log(cols.map(c => `  ${c.name} (${c.type})`).join('\n'));
      
      const count = db.prepare(`SELECT count(*) as c FROM "${table.name}"`).get().c;
      console.log(`  Count: ${count}`);
    }
  }
  db.close();
}

try {
  const dirs = fs.readdirSync(documentsPath);
  for (const dir of dirs) {
    const fullDir = path.join(documentsPath, dir);
    if (fs.statSync(fullDir).isDirectory()) {
      console.log(`Checking account: ${dir}`);
      inspectSchema(path.join(fullDir, 'session.db'));
      inspectSchema(path.join(fullDir, 'contact.db'));
      break;
    }
  }
} catch (e) {
  console.log('Error reading directory:', e);
}
