CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questionnaires (id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,token TEXT NOT NULL UNIQUE,title TEXT NOT NULL,questions_json TEXT NOT NULL,answers_json TEXT,ai_analysis TEXT,review TEXT,status TEXT NOT NULL DEFAULT 'pendente',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,responded_at TEXT,reviewed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_questionnaires_client ON questionnaires(client_id);
