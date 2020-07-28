import {genJpegBlob} from './image/genImage.js';
import * as modal from './utils/modal.js';

const delayToNotRecordKeyboardNoise = 400;
const goBackDuration = 3000;
const tinyDuration = 200;

export class ActionMgr {
  constructor(eBanner, stateMgr) {
    this._eBanner = eBanner;
    this._stateMgr = stateMgr;
    this._startRecordingTimeout = null;
  }

  goToPrevPause() {
    this._handleReplayGracefully(_ => {
      this._stateMgr.goToPrevPause();
    });
  }

  goToNextPause() {
    this._handleReplayGracefully(_ => {
      this._stateMgr.goToNextPause();
    });
  }

  replayAndRecord() {
    if (this._startRecordingTimeout) {
      window.clearTimeout(this._startRecordingTimeout);
      this._stateMgr.pauseReplaying();
      this._eBanner.success('Cancelled start of recording.');
      return;
    }
    this._handleReplayGracefully(async _ => {
      await this.trimRight();
      this._shift(-goBackDuration);
      this._stateMgr.startReplaying();
      this._resumeRecording(goBackDuration);
    }, /* doNotRestartReplayer */ true);
  }

  // Should stop any recording and play from the start of the newest recording.
  async pauseOrResumeReplay() {
    if (this._stateMgr.isRecording()) {
      await this._pauseRecording();
      this.goToPrevStart();
      this._stateMgr.startReplaying();
      return;
    }
    if (this._stateMgr.isReplaying()) {
      await this._stateMgr.pauseReplaying();
      return;
    }
    this._stateMgr.startReplaying();
  }

  // Note that operations are async, we don't need to await for our current use case.
  pauseOrResumeRecording() {
    this._handleReplayGracefully(_ => {
      this._resumeRecording(delayToNotRecordKeyboardNoise, /* enforceDuration */ true);
    }, /* doNotRestartReplayer */ true);
  }

  async _pauseRecording() {
    this._eBanner.inProgress('Paused recording.')
    await this._stateMgr.stopRecording();
    this._shift(-delayToNotRecordKeyboardNoise);
    await this._stateMgr.trimRight();
  }

  _resumeRecording(duration, enforceDuration) {
    if (!enforceDuration) {
      duration = Math.min(this._stateMgr.getTimeLength(), duration);
    }
    for (let idx = 1; idx <= 3; idx++) {
      if (duration >= idx * 500) {
        window.setTimeout(_ => {
          this._eBanner.inProgress(`${idx}`);
        }, duration - idx * 500);
      }
    }
    if (this._startRecordingTimeout) {
      window.clearTimeout(this._startRecordingTimeout);
    }
    this._startRecordingTimeout = window.setTimeout(_ => {
      this._eBanner.success('Recording.');
      this._stateMgr.startRecording();
      this._startRecordingTimeout = null;
    }, duration - 20);  // 20ms early to compensate for startRecording latency
  }

  goToDecimal(decimal) {
    this._handleReplayGracefully(_ => {
      this._stateMgr.setCurrTime(this._stateMgr.getTimeLength() * decimal / 10);
    });
  }
  goToNextStart() {
    this._handleReplayGracefully(_ => {
      this._stateMgr.goToNextStart();
    });
  }

  goToPrevStart() {
    this._handleReplayGracefully(_ => {
      this._stateMgr.goToPrevStart();
    });
  }

  async shiftEvenDuringReplay(timeMs) {
    await this._handleReplayGracefully(_ => {
      this._shift(timeMs);
    });
  }

  _shift(timeMs) {
    this._stateMgr.setCurrTime(this._stateMgr.getCurrTime() + timeMs);
  }

  async trimRight() {
    await this._handleReplayGracefully(async _ => {
      await this._stateMgr.trimRight();
    });
  }

  delete() {
    this._handleReplayGracefully(async _ => {
      this._shift(-tinyDuration);
      await this._stateMgr.trimRight();
    });
  }
  downloadAudio() {
    const name = prompt('Name', 'audio');
    if (!name) {
      return;
    }
    const blob = this._stateMgr.getBlob();
    download(blob, name, 'webm');
  }
  async downloadMp4() {
    const prevName = localStorage.getItem('name');

    const namePromise = modal.prompt('Video Title', prevName);
    const mp3BufferViewPromise = this._stateMgr.convertToMp3();
    const name = await namePromise;
    localStorage.setItem('name', name);
    const jpegBlob = await genJpegBlob(name);
    const mp3BufferView = await mp3BufferViewPromise;
    const nameWithNoSpace = name.split(' ').join('_');
    const blob = await this._stateMgr.convertToMp4(mp3BufferView, jpegBlob);
    download(blob, nameWithNoSpace, 'mp4');
  }

  async _handleReplayGracefully(func, doNotRestartReplayer) {
    if (this._stateMgr.isRecording()) {
      await this._pauseRecording();
      return;
    }
    const shouldPauseAndResumeReplay = this._stateMgr.isReplaying();
    if (shouldPauseAndResumeReplay) {
      await this._stateMgr.pauseReplaying();
    }
    await func();
    if (doNotRestartReplayer) {
      return;
    }
    if (shouldPauseAndResumeReplay) {
      this._stateMgr.startReplaying();
    }
  }
}

function download(blob, name, format) {
  const downloadEl = document.createElement('a');
  downloadEl.download = `${name}.${format}`;
  const blobUrl = URL.createObjectURL(blob);
  downloadEl.href = blobUrl;
  downloadEl.click();
  window.setTimeout(_ => {
    URL.revokeObjectURL(blobUrl);
  }, 1000 * 30);
}