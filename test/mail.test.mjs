import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { sendMail, buildMessage } from '../lib/mail.mjs';

function fakeSmtp({ authOk = true } = {}) {
  const got = { lines: [], data: '' };
  const server = net.createServer(sock => {
    let inData = false, buf = '';
    sock.write('220 smtp.test ready\r\n');
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 2.0.0 OK queued\r\n'); } else got.data += line + '\n';
          continue;
        }
        got.lines.push(line);
        if (line.startsWith('EHLO')) sock.write('250-smtp.test\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8\r\n');
        else if (line.startsWith('AUTH')) sock.write(authOk ? '235 2.7.0 Accepted\r\n' : '535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 Learn more\r\n');
        else if (line.startsWith('MAIL') || line.startsWith('RCPT')) sock.write('250 OK\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 Go ahead\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      }
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, got, port: server.address().port })));
}

test('sends a message through SMTP', async () => {
  const { server, got, port } = await fakeSmtp();
  const to = await sendMail({ user: 'me@gmail.com', pass: 'app pass', to: 'a@x.com, b@x.com', subject: '🔴 Out of budget: ROI_HSS', html: '<b>hi ₹</b>', connect: () => net.connect(port, '127.0.0.1') });
  server.close();
  assert.deepEqual([...to], ['a@x.com', 'b@x.com']);
  assert.equal(to.from, 'me@gmail.com');
  assert.match(to.receipt, /OK queued/);
  assert.ok(got.lines.includes('RCPT TO:<a@x.com>') && got.lines.includes('RCPT TO:<b@x.com>'));
  assert.equal(Buffer.from(got.lines.find(l => l.startsWith('AUTH PLAIN')).slice(11), 'base64').toString(), '\0me@gmail.com\0apppass', 'spaces in the app password are removed');
  assert.match(got.data, /Subject: =\?UTF-8\?B\?/);
  const body = got.data.split('\n\n').slice(1).join('').replace(/\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString(), '<b>hi ₹</b>');
});

test('a refused login is reported clearly', async () => {
  const { server, port } = await fakeSmtp({ authOk: false });
  await assert.rejects(sendMail({ user: 'me@gmail.com', pass: 'bad', subject: 's', html: 'h', connect: () => net.connect(port, '127.0.0.1') }), /login.*535/s);
  server.close();
});

test('missing credentials', async () => {
  await assert.rejects(sendMail({ subject: 's', html: 'h' }), /GMAIL_USER/);
});

test('message lines stay short', () => {
  const m = buildMessage({ from: 'a@b.c', to: ['d@e.f'], subject: 'x', html: 'y'.repeat(5000) });
  assert.ok(m.split('\r\n').every(l => l.length <= 998));
});
