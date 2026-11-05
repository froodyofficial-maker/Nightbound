// Emails big updates to the Buttondown newsletter. Runs in GitHub Actions on every push to main.
// An Inbox entry is emailed when it has `email: true` (big updates: new characters, limited
// editions, new modes) and its id is not yet in .github/emailed.json. Small tweaks never set
// `email`, so they are never mailed. Needs the repository secret BUTTONDOWN_API_KEY.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.cwd(), logPath = join(root, '.github/emailed.json');
const { INBOX } = await import(pathToFileURL(join(root, 'public/js/config.js')).href);
const log = JSON.parse(readFileSync(logPath, 'utf8'));
const sent = new Set(log.ids);
const TEST = process.env.TEST_EMAIL === 'true';
// a test run (Actions > Email big updates > Run workflow > test) mails the latest update once, marked [Test], and records nothing
const due = TEST ? [INBOX[0]] : INBOX.filter(m => m.email && !sent.has(m.id)).reverse(); // oldest first
if (!due.length) { console.log('Nothing new to email.'); process.exit(0); }
const key = process.env.BUTTONDOWN_API_KEY;
if (!key) { console.log('::warning::BUTTONDOWN_API_KEY is not set: skipping emails for ' + due.map(m => m.id).join(', ')); process.exit(0); }

const PLAY = 'https://froodyofficial-maker.github.io/Nightbound/';
const strip = s => String(s).replace(/<[^>]+>/g, '');
for (const m of due) {
  const subject = `${TEST ? '[Test] ' : ''}Nightbound ${m.version}: ${strip(m.title)}`;
  const body = [
    `## ${strip(m.title)}`, '',
    ...(m.body || []).map(line => `- ${strip(line)}`), '',
    m.gift ? `**Free gift in your in-game Inbox:** ${strip(m.gift.label)}\n` : '',
    `[Play Nightbound now](${PLAY}) (refresh the page to get version ${m.version}).`, '',
    '_You get this email because you signed up in Nightbound\'s settings. Only big updates are emailed._',
  ].join('\n');
  const r = await fetch('https://api.buttondown.com/v1/emails', {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json', 'X-Buttondown-Live-Dangerously': 'true' },
    body: JSON.stringify({ subject, body, status: 'about_to_send' }),
  });
  const text = await r.text();
  if (!r.ok) { console.log(`::error::Buttondown refused "${subject}" (${r.status}): ${text.slice(0, 400)}`); process.exit(1); }
  console.log(`Sent: ${subject}`);
  if (TEST) continue;
  log.ids.push(m.id);
  writeFileSync(logPath, JSON.stringify(log, null, 1) + '\n');
}
