

export class KeyboardShortcuts {
  constructor(actionMgr) {
    _hotkeys(`space`, _ => {
      actionMgr.pauseOrResumeReplay();
    });
    // _hotkeys(`shift+space`, _ => {
    //   actionMgr.shift(-goBackDuration)
    //   actionMgr.pauseOrResumeReplay();
    // });
    _hotkeys(`v`, _ => {
      actionMgr.downloadMp4();
    });
    _hotkeys(`enter`, _ => {
      actionMgr.pauseOrResumeRecording();
    });
    _hotkeys(`\\`, _ => {
      actionMgr.replayAndRecord();
    });
    _hotkeys(`left`, _ => {
      actionMgr.shiftEvenDuringReplay(-200);
    });
    _hotkeys(`right`, _ => {
      actionMgr.shiftEvenDuringReplay(200);
    });
    _hotkeys(`up`, _ => {
      actionMgr.shiftEvenDuringReplay(-5000);
    });
    _hotkeys(`down`, _ => {
      actionMgr.shiftEvenDuringReplay(5000);
    });
    _hotkeys(`k`, _ => {
      actionMgr.goToNextStart();
    });
    _hotkeys(`j`, _ => {
      actionMgr.goToPrevStart();
    });
    _hotkeys(`n`, _ => {
      actionMgr.goToNextPause();
    });
    _hotkeys(`p`, _ => {
      actionMgr.goToPrevPause();
    });
    _hotkeys(`0,1,2,3,4,5,6,7,8,9`, (_, hotkeysHandler) => {
      actionMgr.goToDecimal(parseInt(hotkeysHandler.key));
    });
    _hotkeys(`shift+backspace`, _ => {
      actionMgr.trimRight();
    });
    _hotkeys(`backspace`, _ => {
      actionMgr.delete();
    });
    _hotkeys(`${cmdKeyString()}+s`, _ => {
      actionMgr.download();
    });
    // _hotkeys(`d`, _ => {
    //   actionMgr.denoise();
    // });
  }
}

function _hotkeys(shortcut, handler) {
  hotkeys(shortcut, (evt, hotkeysHandler) => {
    evt.preventDefault();
    handler(evt, hotkeysHandler);
  })
}

function isMac() {
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
}

function isCros() {
  return /\bCrOS\b/.test(navigator.userAgent);
}

function cmdKey() {
  if (isMac()) {
    return 'metaKey';
  }
  return 'ctrlKey';
}

function cmdKeyString() {
  if (isMac()) {
    return 'command';
  }
  return 'ctrl';
}