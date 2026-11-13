import assert from 'node:assert/strict';
import { createListenReminder, LISTEN_INTERVAL_MS, LISTEN_REPLY_MS } from '../src/audio/listenReminder.mjs';

let time = 0;
const warnings = [];
let pauses = 0;
const reminder = createListenReminder({ startedAt: 0, now: () => time, onWarn: (deadline) => warnings.push(deadline), onPause: () => pauses++ });
time = LISTEN_INTERVAL_MS - 1; reminder.tick(); assert.equal(warnings.length, 0);
time++; reminder.tick(); assert.deepEqual(warnings, [time + LISTEN_REPLY_MS]);
time += LISTEN_REPLY_MS - 1; reminder.tick(); assert.equal(pauses, 0);
reminder.confirm();
time += LISTEN_INTERVAL_MS - 1; reminder.tick(); assert.equal(warnings.length, 1);
time++; reminder.tick(); assert.equal(warnings.length, 2);
time += LISTEN_REPLY_MS; reminder.tick(); reminder.tick(); assert.equal(pauses, 1);
reminder.cancel(); time += LISTEN_INTERVAL_MS; reminder.tick(); assert.equal(pauses, 1);

// Retomada depois de suspensão do PC: oferece 60 s a partir do aviso visível.
const delayed = createListenReminder({ startedAt: time, now: () => time, onWarn: (deadline) => warnings.push(deadline), onPause: () => pauses++ });
time += LISTEN_INTERVAL_MS * 2; delayed.tick(); assert.equal(warnings.at(-1), time + LISTEN_REPLY_MS);
time += LISTEN_REPLY_MS; delayed.tick(); assert.equal(pauses, 2);
console.log('PASS: 30 min, confirmação, pausa após 60 s, cancelamento e relógio atrasado');
