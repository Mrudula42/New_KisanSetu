import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';

export function hiddenQuestion(
  prompt,
  { input = stdin, output = stdout } = {}
) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(
      new Error('Run this command in an interactive VS Code terminal so the password can be entered without echo.')
    );
  }

  return new Promise((resolve, reject) => {
    const originalRawMode = input.isRaw;
    let value = '';
    let settled = false;

    const cleanup = () => {
      input.removeListener('keypress', onKeypress);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      process.removeListener('SIGINT', onInterrupt);

      let restoreError;
      try {
        if (input.isRaw !== originalRawMode) {
          input.setRawMode(originalRawMode);
        }
      } catch (error) {
        restoreError = error;
      }
      try {
        output.write('\n');
      } catch (error) {
        restoreError ||= error;
      }
      return restoreError;
    };

    const finish = (error) => {
      if (settled) return;
      settled = true;
      const restoreError = cleanup();
      if (error && restoreError) {
        reject(new AggregateError([error, restoreError], 'Input failed and terminal mode could not be restored.'));
      } else if (error) reject(error);
      else if (restoreError) reject(new Error('Could not restore terminal input mode.', { cause: restoreError }));
      else resolve(value);
    };

    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        finish(new Error('Administrator setup cancelled.'));
      } else if ((key.ctrl && ['d', 'z'].includes(key.name)) || key.name === 'escape') {
        finish(new Error('Administrator setup cancelled.'));
      } else if (key.name === 'return' || key.name === 'enter') {
        finish();
      } else if (key.name === 'backspace' || key.name === 'delete') {
        value = Array.from(value).slice(0, -1).join('');
      } else if (!key.ctrl && !key.meta && typeof character === 'string'
        && !/[\u0000-\u001f\u007f]/.test(character)) {
        value += character;
      }
    };
    const onEnd = () => finish(new Error('Password input ended before confirmation.'));
    const onError = (error) => finish(error);
    const onInterrupt = () => finish(new Error('Administrator setup cancelled.'));

    try {
      output.write(prompt);
      emitKeypressEvents(input);
      input.on('keypress', onKeypress);
      input.once('end', onEnd);
      input.once('error', onError);
      process.once('SIGINT', onInterrupt);
      input.setRawMode(true);
      input.resume();
    } catch (error) {
      finish(error);
    }
  });
}
