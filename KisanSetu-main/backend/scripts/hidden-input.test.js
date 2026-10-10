import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { hiddenQuestion } from './hidden-input.js';

class FakeTerminal extends EventEmitter {
  isTTY = true;
  isRaw = false;
  transitions = [];

  setRawMode(enabled) {
    this.transitions.push(enabled);
    this.isRaw = enabled;
  }

  resume() {}
}

class FakeOutput {
  text = '';

  write(value) {
    this.text += value;
    return true;
  }
}

test('hidden input reads characters without echo and restores terminal mode on Enter', async () => {
  const input = new FakeTerminal();
  const output = new FakeOutput();
  const result = hiddenQuestion('Password: ', { input, output });

  assert.equal(input.isRaw, true);
  input.emit('keypress', 's', {});
  input.emit('keypress', 'e', {});
  input.emit('keypress', 'c', {});
  input.emit('keypress', 'r', {});
  input.emit('keypress', 'e', {});
  input.emit('keypress', 't', {});
  input.emit('keypress', undefined, { name: 'return' });

  assert.equal(await result, 'secret');
  assert.equal(input.isRaw, false);
  assert.deepEqual(input.transitions, [true, false]);
  assert.equal(output.text, 'Password: \n');
});

test('hidden input restores terminal mode after cancellation', async () => {
  const input = new FakeTerminal();
  const output = new FakeOutput();
  const result = hiddenQuestion('Password: ', { input, output });

  input.emit('keypress', 'x', {});
  input.emit('keypress', '\u0003', { ctrl: true, name: 'c' });

  await assert.rejects(result, /cancelled/i);
  assert.equal(input.isRaw, false);
  assert.deepEqual(input.transitions, [true, false]);
  assert.equal(output.text, 'Password: \n');
});

test('hidden input restores terminal mode on input errors', async () => {
  const input = new FakeTerminal();
  const output = new FakeOutput();
  const result = hiddenQuestion('Password: ', { input, output });
  const inputError = new Error('input failed');

  input.emit('error', inputError);

  await assert.rejects(result, (error) => error === inputError);
  assert.equal(input.isRaw, false);
  assert.deepEqual(input.transitions, [true, false]);
  assert.equal(output.text, 'Password: \n');
});

test('hidden input restores terminal mode when raw-mode setup throws', async () => {
  const input = new FakeTerminal();
  input.setRawMode = (enabled) => {
    input.transitions.push(enabled);
    input.isRaw = enabled;
    if (enabled) throw new Error('raw mode setup failed');
  };
  const output = new FakeOutput();

  await assert.rejects(hiddenQuestion('Password: ', { input, output }), /raw mode setup failed/);
  assert.equal(input.isRaw, false);
  assert.deepEqual(input.transitions, [true, false]);
  assert.equal(output.text, 'Password: \n');
});

test('hidden input reports terminal restoration failures', async () => {
  const input = new FakeTerminal();
  input.setRawMode = (enabled) => {
    input.transitions.push(enabled);
    if (enabled) input.isRaw = true;
    else throw new Error('raw mode restore failed');
  };
  const output = new FakeOutput();
  const result = hiddenQuestion('Password: ', { input, output });

  input.emit('keypress', '\u0003', { ctrl: true, name: 'c' });

  await assert.rejects(result, (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /terminal mode could not be restored/i);
    return true;
  });
  assert.deepEqual(input.transitions, [true, false]);
  assert.equal(output.text, 'Password: \n');
});
