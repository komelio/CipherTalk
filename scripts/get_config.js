const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const configDbPath = path.join(require('os').homedir(), 'AppData', 'Roaming', 'CipherTalk', 'ciphertalk-config.db');

try {
  const db = new Database(configDbPath, { readonly: true });
  const rows = db.prepare("SELECT * FROM config").all();
  console.log('Config rows:', rows);
  
  const cachePathRow = rows.find(r => r.key === 'cachePath');
  const myWxidRow = rows.find(r => r.key === 'myWxid');
  
  if (cachePathRow && myWxidRow) {
      console.log('Cache path:', cachePathRow.value);
      console.log('Wxid:', myWxidRow.value);
      
      const publicMsgPath = path.join(cachePathRow.value, myWxidRow.value, 'PublicMsg.db');
      console.log('Checking PublicMsg.db at:', publicMsgPath);
      
      if (fs.existsSync(publicMsgPath)) {
         const pDb = new Database(publicMsgPath, { readonly: true });
         const tables = pDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
         const msgTables = tables.filter(t => t.name.toLowerCase().startsWith('msg_'));
         console.log(`Found ${msgTables.length} Msg_ tables in PublicMsg.db`);
         if (msgTables.length > 0) {
            console.log('Sample:', msgTables.slice(0, 10).map(t => t.name).join(', '));
            
            // Check gh_ mapping if name2id exists
            if (tables.some(t => t.name.toLowerCase() === 'name2id')) {
                const n2i = pDb.prepare("SELECT * FROM Name2Id LIMIT 10").all();
                console.log('Name2Id sample:', n2i);
            }
         }
      } else {
         console.log('PublicMsg.db not found');
      }
  }

} catch(e) {
  console.error(e);
}
