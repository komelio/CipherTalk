const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

function md5(input) {
  return crypto.createHash('md5').update(String(input)).digest('hex').toLowerCase()
}

function cleanAccountDirName(rawWxid) {
  if (!rawWxid) return ''
  let cleaned = String(rawWxid).trim()
  cleaned = cleaned.replace(/^wxid_/i, '')
  cleaned = cleaned.replace(/_[0-9a-f]{4,}$/i, '')
  cleaned = cleaned.replace(/^\s+|\s+$/g, '')
  return cleaned
}

function toObjRows(rows, keyField = 'key', valueField = 'value') {
  const out = {}
  for (const row of rows) {
    const k = row?.[keyField]
    if (k != null) out[String(k)] = row?.[valueField]
  }
  return out
}

function normalizeConfigValue(v) {
  if (v == null) return ''
  let s = String(v).trim()
  if (!s) return ''
  try {
    const parsed = JSON.parse(s)
    if (typeof parsed === 'string') return parsed.trim()
    if (parsed == null) return ''
    return String(parsed).trim()
  } catch {}
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  return s
}

function safeReadTables(db) {
  try {
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  } catch {
    return []
  }
}

function resolveAccountDir(baseDir, wxid) {
  if (!baseDir || !wxid || !fs.existsSync(baseDir)) return null
  const cleaned = cleanAccountDirName(wxid)
  const cands = [wxid, cleaned].filter(Boolean)
  for (const c of cands) {
    const p = path.join(baseDir, c)
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return c
  }
  const entries = fs.readdirSync(baseDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  const wxLower = wxid.toLowerCase()
  const clLower = cleaned.toLowerCase()
  for (const name of entries) {
    const n = name.toLowerCase()
    if (n === wxLower || n === clLower) return name
    if (n.startsWith(wxLower + '_') || n.startsWith(clLower + '_')) return name
    if (wxLower.startsWith(n + '_') || clLower.startsWith(n + '_')) return name
    const cleanedName = cleanAccountDirName(name).toLowerCase()
    if (cleanedName === wxLower || cleanedName === clLower) return name
  }
  return null
}

function getName2IdNameCol(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(Name2Id)").all().map(c => c.name)
    if (cols.includes('usrName')) return 'usrName'
    if (cols.includes('user_name')) return 'user_name'
  } catch {}
  return null
}

function getContactAlias(contactDb, sessionId) {
  try {
    const cols = contactDb.prepare("PRAGMA table_info(contact)").all().map(c => c.name)
    const pick = ['username', 'alias', 'remark', 'nick_name'].filter(c => cols.includes(c))
    if (pick.length === 0) return null
    const row = contactDb.prepare(`SELECT ${pick.join(', ')} FROM contact WHERE username = ? LIMIT 1`).get(sessionId)
    return row || null
  } catch {
    return null
  }
}

function extractTableHash(name) {
  const m = String(name).match(/msg_([0-9a-f]{32})/i)
  return m?.[1]?.toLowerCase() || null
}

function analyzeDb(dbPath, sessionIds, contactDb) {
  const db = new Database(dbPath, { readonly: true })
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  const msgTables = tables.filter(t => /^msg_/i.test(t))
  const name2IdExists = tables.some(t => t.toLowerCase() === 'name2id')
  const nameCol = name2IdExists ? getName2IdNameCol(db) : null
  const dbTitle = `${path.basename(dbPath)} (${dbPath})`
  console.log(`\n========== DB: ${dbTitle} ==========`) 
  console.log(`tables_total=${tables.length}, msg_tables=${msgTables.length}, has_name2id=${name2IdExists}, name_col=${nameCol || 'N/A'}`)
  console.log(`msg_table_sample=${msgTables.slice(0, 12).join(', ')}`)
  if (name2IdExists) {
    try {
      const name2IdSchema = db.prepare("PRAGMA table_info(Name2Id)").all()
      console.log(`name2id_schema=${JSON.stringify(name2IdSchema)}`)
      const ghLike = nameCol ? db.prepare(`SELECT * FROM Name2Id WHERE ${nameCol} LIKE 'gh_%' LIMIT 5`).all() : []
      console.log(`name2id_gh_sample=${JSON.stringify(ghLike)}`)
    } catch (e) {
      console.log(`name2id_read_error=${String(e)}`)
    }
  }
  if (msgTables.length > 0) {
    try {
      const firstSchema = db.prepare(`PRAGMA table_info(${msgTables[0]})`).all()
      console.log(`first_msg_table=${msgTables[0]}`)
      console.log(`first_msg_schema=${JSON.stringify(firstSchema)}`)
    } catch (e) {
      console.log(`first_msg_schema_error=${String(e)}`)
    }
  }

  for (const sid of sessionIds) {
    const hashes = new Map()
    hashes.set('sessionId', md5(sid))
    hashes.set('sessionIdLower', md5(String(sid).toLowerCase()))
    hashes.set('sessionIdUpper', md5(String(sid).toUpperCase()))
    hashes.set('cleanedSessionId', md5(cleanAccountDirName(sid)))

    const contactRow = contactDb ? getContactAlias(contactDb, sid) : null
    if (contactRow?.alias) hashes.set('contact.alias', md5(contactRow.alias))
    if (contactRow?.remark) hashes.set('contact.remark', md5(contactRow.remark))
    if (contactRow?.nick_name) hashes.set('contact.nick_name', md5(contactRow.nick_name))

    let n2iRow = null
    if (name2IdExists && nameCol) {
      try {
        n2iRow = db.prepare(`SELECT * FROM Name2Id WHERE ${nameCol} = ? LIMIT 1`).get(sid) || null
      } catch {}
      const alias = n2iRow?.alias || n2iRow?.Alias
      if (alias) hashes.set('name2id.alias', md5(alias))
      if (n2iRow?.[nameCol]) hashes.set(`name2id.${nameCol}`, md5(n2iRow[nameCol]))
    }

    const hashToReason = new Map()
    for (const [reason, h] of hashes.entries()) {
      if (!h) continue
      if (!hashToReason.has(h)) hashToReason.set(h, [])
      hashToReason.get(h).push(reason)
    }

    const hitTables = []
    for (const t of msgTables) {
      const th = extractTableHash(t)
      if (!th) continue
      if (hashToReason.has(th)) {
        hitTables.push({ table: t, hash: th, reason: hashToReason.get(th).join('|') })
      }
    }

    console.log(`\n--- Session: ${sid} ---`)
    console.log(`candidate_hashes=${JSON.stringify(Object.fromEntries(hashToReason.entries()))}`)
    if (contactRow) console.log(`contact_row=${JSON.stringify(contactRow)}`)
    if (n2iRow) console.log(`name2id_row=${JSON.stringify(n2iRow)}`)
    if (hitTables.length > 0) {
      console.log(`match_count=${hitTables.length}`)
      for (const hit of hitTables.slice(0, 20)) {
        console.log(`match_table=${hit.table}, hash=${hit.hash}, reason=${hit.reason}`)
      }
      const first = hitTables[0].table
      try {
        const cols = db.prepare(`PRAGMA table_info(${first})`).all()
        console.log(`match_table_schema=${JSON.stringify(cols)}`)
        const sampleRows = db.prepare(`SELECT local_id, server_id, local_type, create_time, sort_seq, real_sender_id FROM ${first} ORDER BY sort_seq DESC LIMIT 5`).all()
        console.log(`match_table_sample_rows=${JSON.stringify(sampleRows)}`)
      } catch (e) {
        console.log(`read_match_table_error=${String(e)}`)
      }
    } else {
      console.log(`match_count=0`)
    }
  }
  db.close()
}

function main() {
  const configDbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'CipherTalk', 'ciphertalk-config.db')
  if (!fs.existsSync(configDbPath)) {
    console.error(`config_db_not_found=${configDbPath}`)
    process.exit(1)
  }
  const cfgDb = new Database(configDbPath, { readonly: true })
  const cfgRows = cfgDb.prepare("SELECT * FROM config").all()
  cfgDb.close()
  const cfg = toObjRows(cfgRows)
  const cachePath = normalizeConfigValue(cfg.cachePath)
  const myWxid = normalizeConfigValue(cfg.myWxid)
  if (!cachePath || !myWxid) {
    console.error(`invalid_config cachePath=${cachePath}, myWxid=${myWxid}`)
    process.exit(1)
  }

  const accountDir = resolveAccountDir(cachePath, myWxid)
  if (!accountDir) {
    console.error(`account_dir_not_found base=${cachePath}, myWxid=${myWxid}`)
    process.exit(1)
  }

  const dbDir = path.join(cachePath, accountDir)
  const sessionDbPath = path.join(dbDir, 'session.db')
  const files = fs.readdirSync(dbDir)
  const msgDbFiles = files
    .filter(f => /^(message|msg|publicmsg|biz_message).*\.db$/i.test(f))
    .map(f => path.join(dbDir, f))
    .sort((a, b) => a.localeCompare(b, 'en'))
  const allDbFiles = files
    .filter(f => /\.db$/i.test(f))
    .map(f => path.join(dbDir, f))
    .sort((a, b) => a.localeCompare(b, 'en'))

  const sessionIdsFromArg = process.argv.slice(2).filter(Boolean)
  const defaultTargets = ['gh_14a37955a574', 'cmb4008205555']
  const targets = sessionIdsFromArg.length > 0 ? sessionIdsFromArg : defaultTargets

  let contactDb = null
  const contactDbPath = path.join(dbDir, 'contact.db')
  if (fs.existsSync(contactDbPath)) {
    try {
      contactDb = new Database(contactDbPath, { readonly: true })
    } catch {}
  }

  console.log(`config_db=${configDbPath}`)
  console.log(`cachePath=${cachePath}`)
  console.log(`myWxid=${myWxid}`)
  console.log(`resolvedAccountDir=${accountDir}`)
  console.log(`dbDir=${dbDir}`)
  console.log(`targets=${targets.join(',')}`)
  console.log(`msgDbCount=${msgDbFiles.length}`)
  console.log(`msgDbs=${JSON.stringify(msgDbFiles)}`)
  console.log(`allDbCount=${allDbFiles.length}`)

  if (fs.existsSync(sessionDbPath)) {
    try {
      const sdb = new Database(sessionDbPath, { readonly: true })
      const stables = safeReadTables(sdb)
      const sessionTable = ['SessionTable', 'Session', 'session'].find(t => stables.includes(t))
      console.log(`session_db=${sessionDbPath}`)
      console.log(`session_tables=${JSON.stringify(stables)}`)
      console.log(`session_table_name=${sessionTable || ''}`)
      if (sessionTable) {
        const sessionSchema = sdb.prepare(`PRAGMA table_info(${sessionTable})`).all()
        console.log(`session_table_schema=${JSON.stringify(sessionSchema)}`)
        const ghRows = sdb.prepare(`SELECT * FROM ${sessionTable} WHERE username LIKE 'gh_%' LIMIT 10`).all()
        console.log(`session_gh_sample=${JSON.stringify(ghRows)}`)
        for (const sid of targets) {
          const rows = sdb.prepare(`SELECT * FROM ${sessionTable} WHERE username = ? LIMIT 5`).all(sid)
          console.log(`session_row_${sid}=${JSON.stringify(rows)}`)
        }
      }
      sdb.close()
    } catch (e) {
      console.log(`session_db_error=${String(e)}`)
    }
  }

  if (contactDb) {
    try {
      const ctables = safeReadTables(contactDb)
      console.log(`contact_db=${contactDbPath}`)
      console.log(`contact_tables=${JSON.stringify(ctables)}`)
      if (ctables.includes('contact')) {
        const contactSchema = contactDb.prepare("PRAGMA table_info(contact)").all()
        console.log(`contact_schema=${JSON.stringify(contactSchema)}`)
      }
      const ghContact = contactDb.prepare("SELECT username, alias, remark, nick_name, local_type FROM contact WHERE username LIKE 'gh_%' LIMIT 10").all()
      console.log(`contact_gh_sample=${JSON.stringify(ghContact)}`)
      for (const sid of targets) {
        const crow = contactDb.prepare("SELECT * FROM contact WHERE username = ? LIMIT 1").get(sid)
        console.log(`contact_row_${sid}=${JSON.stringify(crow || null)}`)
      }
    } catch (e) {
      console.log(`contact_db_error=${String(e)}`)
    }
  }

  for (const dbPath of msgDbFiles) {
    try {
      analyzeDb(dbPath, targets, contactDb)
    } catch (e) {
      console.log(`analyze_db_error path=${dbPath} error=${String(e)}`)
    }
  }

  const scannedMsgSet = new Set(msgDbFiles.map(p => p.toLowerCase()))
  const otherDbs = allDbFiles.filter(p => !scannedMsgSet.has(p.toLowerCase()))
  console.log(`\n========== DEEP SCAN OTHER DBS ==========`) 
  console.log(`otherDbCount=${otherDbs.length}`)
  for (const dbPath of otherDbs) {
    try {
      const db = new Database(dbPath, { readonly: true })
      const tables = safeReadTables(db)
      let hitCount = 0
      for (const t of tables) {
        try {
          const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
          const nameCol = cols.find(c => ['username', 'user_name', 'talker', 'strtalker', 'biz_username', 'sender', 'receiver'].includes(String(c).toLowerCase()))
          if (!nameCol) continue
          for (const sid of targets) {
            const row = db.prepare(`SELECT * FROM ${t} WHERE ${nameCol} = ? LIMIT 1`).get(sid)
            if (row) {
              if (hitCount === 0) {
                console.log(`\nother_db_hit=${dbPath}`)
              }
              hitCount += 1
              console.log(`table=${t}, col=${nameCol}, session=${sid}, row=${JSON.stringify(row)}`)
            }
          }
        } catch {}
      }
      db.close()
    } catch (e) {
      console.log(`deep_scan_error path=${dbPath} error=${String(e)}`)
    }
  }

  if (contactDb) contactDb.close()
}

main()
