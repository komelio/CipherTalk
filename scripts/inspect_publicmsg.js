const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const documentsPath = require('os').homedir() + '\\Documents\\CipherTalkData';

function inspectPublicMsg(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log(`DB not found: ${dbPath}`);
    return;
  }
  console.log(`\n--- Inspecting ${dbPath} ---`);
  try {
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log(`Found ${tables.length} tables`);
    
    // Check if there are any Msg_ tables
    const msgTables = tables.filter(t => t.name.toLowerCase().startsWith('msg_'));
    console.log(`Found ${msgTables.length} Msg_ tables. Samples:`);
    console.log(msgTables.slice(0, 10).map(t => t.name).join(', '));
    
    // Try to see if there is any other kind of table for official accounts
    const otherTables = tables.filter(t => !t.name.toLowerCase().startsWith('msg_') && !t.name.toLowerCase().startsWith('sqlite_'));
    console.log(`Found ${otherTables.length} other tables. Samples:`);
    console.log(otherTables.slice(0, 10).map(t => t.name).join(', '));
    
    // Check if we can find name2id to map gh_ to table
    if (tables.some(t => t.name.toLowerCase() === 'name2id')) {
       console.log('Found Name2Id table. Checking for gh_ mapping...');
       const ghRows = db.prepare("SELECT * FROM Name2Id WHERE usrName LIKE 'gh_%' OR user_name LIKE 'gh_%' LIMIT 5").all();
       console.log('gh_ mapping rows:', ghRows);
    }

    db.close();
  } catch (e) {
    console.log('Error opening db:', e);
  }
}

try {
  const dirs = fs.readdirSync(documentsPath);
  for (const dir of dirs) {
    const fullDir = path.join(documentsPath, dir);
    if (fs.statSync(fullDir).isDirectory()) {
      console.log(`Checking account: ${dir}`);
      const publicMsgPath = path.join(fullDir, 'PublicMsg.db');
      inspectPublicMsg(publicMsgPath);
      break;
    }
  }
} catch (e) {
  console.log('Error reading directory:', e);
}