
export let promptIsFocused = false;

export function prompt(placeholder, currVal) {
  const textInputHtml = document.createElement('textarea');
  textInputHtml.id = 'modal-prompt-textarea'; // TODO check for id clash.
  textInputHtml.cols = 32;
  textInputHtml.rows = 6;
  textInputHtml.style.fontSize = '48px';
  textInputHtml.style.position = 'fixed';
  textInputHtml.style.top = '50%';
  textInputHtml.style.left = '50%';
  const transform = 'translate(-50%, -50%)'
  textInputHtml.style.webkitTransform = transform;
  textInputHtml.style.mozTransform = transform;
  textInputHtml.style.msTransform = transform;
  textInputHtml.style.oTransform = transform;

  const defaultPlaceHolder = 'Press Enter to submit.';
  textInputHtml.placeholder = placeholder || defaultPlaceHolder;
  textInputHtml.value = currVal || '';

  document.body.appendChild(textInputHtml);
  promptIsFocused = true;
  textInputHtml.focus();
  textInputHtml.select();

  const cleanup = _ => {
    textInputHtml.blur();
    promptIsFocused = false;
    textInputHtml.remove();
  }

  const promptResultPromise = new Promise( (resolve) => {
    textInputHtml.addEventListener('keydown', evt => {
      if (evt.code == 'Enter' && !evt.shiftKey) {
        evt.preventDefault();
        resolve(textInputHtml.value);
        cleanup();
      }
      if (evt.code == 'Escape') {
        evt.preventDefault();
        resolve(currVal);
        cleanup();
      }
    });
  });
  return promptResultPromise;
}
