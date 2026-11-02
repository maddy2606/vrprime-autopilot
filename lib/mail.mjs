// Sends one email through Gmail's SMTP server (smtp.gmail.com:465, TLS) with a Gmail app password.
// No packages: a small SMTP client on node:tls.

import tls from 'node:tls';

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = s => s.replace(/.{1,76}/g, m => m + '\r\n');
const encodeHeader = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/** The full RFC 5322 message (HTML body, base64 so no line is too long and no dot-stuffing is needed). */
export function buildMessage({ from, to, subject, html, date = new Date() }) {
  const id = `<${date.getTime()}.${Math.random().toString(36).slice(2)}@vrprime-autopilot>`;
  return [
    `From: VRPRIME Autopilot <${from}>`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(html)),
  ].join('\r\n');
}

/** Talks SMTP over an already-open socket: resolves each full reply (multi-line aware). */
function replies(socket) {
  let buf = '';
  const queue = [], waiters = [];
  let failed = null;
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buf += chunk;
    let lines;
    while ((lines = buf.match(/^((?:\d{3}-[^\r\n]*\r?\n)*\d{3}(?: [^\r\n]*)?\r?\n)/))) {
      buf = buf.slice(lines[1].length);
      const text = lines[1].trim();
      const reply = { code: Number(text.split(/\r?\n/).pop().slice(0, 3)), text };
      waiters.length ? waiters.shift().resolve(reply) : queue.push(reply);
    }
  });
  const fail = e => { failed = e; while (waiters.length) waiters.shift().reject(e); };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('The mail server closed the connection.')));
  return () => (queue.length ? Promise.resolve(queue.shift()) : failed ? Promise.reject(failed) : new Promise((resolve, reject) => waiters.push({ resolve, reject })));
}

export async function sendMail({ user, pass, to, subject, html, host = 'smtp.gmail.com', port = 465, connect, timeoutMs = 30000 }) {
  if (!user || !pass) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD are not set, so no email was sent.');
  user = String(user).trim();
  pass = String(pass).replace(/\s+/g, ''); // app passwords are shown as 'abcd efgh ijkl mnop'
  const recipients = (Array.isArray(to) ? to : String(to || user).split(',')).map(s => s.trim()).filter(Boolean);
  const socket = connect ? connect() : tls.connect({ host, port, servername: host });
  socket.setTimeout?.(timeoutMs, () => socket.destroy(new Error('The mail server timed out.')));
  const next = replies(socket);
  const send = async (line, expect, label = line.split(' ')[0]) => {
    if (line !== null) socket.write(line + '\r\n');
    const r = await next();
    if (!expect.includes(r.code)) throw new Error(`Gmail refused ${label}: ${r.text.slice(0, 200)}`);
    return r;
  };
  try {
    await send(null, [220], 'the connection');
    await send('EHLO vrprime-autopilot', [250]);
    await send(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`, [235], 'the login (check GMAIL_USER and GMAIL_APP_PASSWORD)');
    await send(`MAIL FROM:<${user}>`, [250]);
    for (const r of recipients) await send(`RCPT TO:<${r}>`, [250, 251], `recipient ${r}`);
    await send('DATA', [354]);
    await send(buildMessage({ from: user, to: recipients, subject, html }) + '\r\n.', [250], 'the message');
    await send('QUIT', [221]).catch(() => {});
  } finally {
    socket.end?.();
  }
  return recipients;
}
