import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const URL = 'https://api.supabase.com/v1/projects/cbcevjhvgmxrxeeyldza/database/query';
async function sql(q) {
  const r = await fetch(URL, { method:'POST', headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json'}, body:JSON.stringify({query:q})});
  return JSON.parse(await r.text());
}
const tests = [
  `SELECT to_tsvector('english','MG0110') AS upper, to_tsvector('english','mg0110') AS lower, to_tsvector('english','MG0110Cols') AS cols, to_tsvector('english','12oz-recycled-canvas') AS slug;`,
  `SELECT websearch_to_tsquery('english','MG0110') AS q_upper, websearch_to_tsquery('english','mg0110') AS q_lower, websearch_to_tsquery('english','mg0110 polo') AS q_combo;`,
  `SELECT to_tsvector('english','MG0110') @@ websearch_to_tsquery('english','mg0110') AS upper_index_lower_query, to_tsvector('english','mg0110') @@ websearch_to_tsquery('english','MG0110') AS lower_index_upper_query;`,
];
for (const q of tests) {
  console.log('\nSQL:', q);
  console.log(JSON.stringify(await sql(q), null, 2));
}
