import * as pubSub from '/utils/pubSub.js'
import {AudioRecorder} from './record.js';
import {RecordState} from './state.js';
import { Downloader } from './download.js';
import { Replayer } from './replay.js';
import {toWaveForm} from './computeWaveForm.js';
import { WebmToMp3Converter } from '../converter/ffmpeg.js';


// This impl assumes that we never record in the middle of a recording.
export class RecordStateMgr {
  constructor(
    audioCtx, pointerChangePub, recorderStoppedPub, recorderStoppedSub,
    audioChunkPub, audioChunkSub, microphoneRecordingsHtml) {
    this._audioCtx = audioCtx;
    // TODO: _pointerChangeSub should really be genWaveFormSub.
    this._pointerChangePub = pointerChangePub;

    this._mimeType = 'audio/webm;codecs=opus';
    this._fileFormat = 'webm';
    // There is a risk of error from decoding if we make this smaller.
    this._msPerChunk = 100;

    const [chunkRecordedPub, chunkRecordedSub] = pubSub.make();
    const [replayerTimePub, replayerTimeSub] = pubSub.make();
    this._state = new RecordState(audioChunkSub, chunkRecordedPub);
    this._downloader = new Downloader(microphoneRecordingsHtml);
    this._audioRecorder = new AudioRecorder(
      this._mimeType, this._msPerChunk, audioChunkPub, recorderStoppedPub, audioCtx);
    this._replayer = new Replayer(audioCtx, replayerTimePub);
    // Note: this._chunkPointerIdx < this._state.getChunks().length + 1
    // Note: this._chunkPointerIdx < this._pointerTimes.length (this._pointerTimes.length + 1 when recording).
    this._chunkPointerIdx = 0;
    this._pointerTimes = [new PointerTime(0, /* isAccurate */ true)];
    this._startIndices = [];
    this._audioBufferCache = new AudioBufferCache();
    this._converter = new WebmToMp3Converter();

    chunkRecordedSub(_ => {
      this._setChunkPointerIdxAndPub(this.getChunkLength());
    });
    recorderStoppedSub(_ => {
      this._reloadAssets();
    });
    replayerTimeSub((timeMs, ended) => {
      if (ended) {
        this._setChunkPointerIdxAndPub(this.getChunkLength());
        return;
      }
      this.setCurrTime(timeMs);
    });
  }

  setFileFormat(fileFormat) {
    this._fileFormat = fileFormat;
  }

  async convertToMp3() {
    const chunks = this._getChunks();
    const mp3BufferViews = [];
    for (let idx = 0; idx < this._startIndices.length; idx++) {
      const startIdx = this._startIndices[idx];
      const endIdx = idx + 1 == this._startIndices.length ? chunks.length : this._startIndices[idx + 1];
      console.log(startIdx, endIdx, chunks.slice(startIdx, endIdx));
      const blob = this._toBlob(chunks.slice(startIdx, endIdx));
      const bufferView = await this._toBufferView(blob);
      mp3BufferViews.push(await this._converter.toMp3(await bufferView, this._fileFormat));
      // mp3BufferViews.push(await this._converter.webmToMp3(await bufferView));
    }
    return await this._converter.concatMp3(mp3BufferViews);
  }

  async convertToMp4(mp3BufferView, jpegBlob) {
    const imageBufferView = await this._toBufferView(jpegBlob);
    const mp4BufferView = await this._converter.mp3ToMp4(mp3BufferView, imageBufferView, this.getTimeLength());
    return new Blob([mp4BufferView.buffer]);
  }

  async _toBufferView(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  goToPrevStart() {
    if (this._startIndices.length == 0) {
      this.setCurrTime(0);
      return;
    }
    const startIndicesIdx = roughBinarySearch(this._startIndices, this._chunkPointerIdx);
    if (startIndicesIdx == 0) {
      this._setChunkPointerIdxAndPub(this._startIndices[startIndicesIdx]);
      return;
    } 
    let wantChunkPointerIdx = this._startIndices[startIndicesIdx];
    if (wantChunkPointerIdx >= this._chunkPointerIdx) {
      wantChunkPointerIdx = this._startIndices[startIndicesIdx - 1];
    }
    this._setChunkPointerIdxAndPub(wantChunkPointerIdx);
  }

  goToNextStart() {
    if (this._startIndices.length == 0) {
      return;
    }
    const startIndicesIdx = roughBinarySearch(this._startIndices, this._chunkPointerIdx);
    if (startIndicesIdx >= this._startIndices.length - 1) {
      this._setChunkPointerIdxAndPub(this._startIndices[startIndicesIdx]);
      return;
    } 
    let wantChunkPointerIdx = this._startIndices[startIndicesIdx];
    if (wantChunkPointerIdx <= this._chunkPointerIdx) {
      wantChunkPointerIdx = this._startIndices[startIndicesIdx + 1];
    }
    this._setChunkPointerIdxAndPub(wantChunkPointerIdx);
  }

  async _computeGoodPickups() {
    const audioBufferCache = await this.getCachedAudioBufferInWindow();
    const audioBuffer = audioBufferCache.content;
    const msPerBar = 100;
    const bufferDurationMs = audioBuffer.duration * 1000;
    const numBars = bufferDurationMs / msPerBar;
    const actualStartTime = audioBufferCache.actualStartTime;
    const timeToIdx = time => {
      const idx = Math.floor((time - actualStartTime) / msPerBar);
      return Math.max(0, idx);
    };
    const idxToTime = idx => {
      return actualStartTime + idx * msPerBar;
    };
    const goodPickups = [];
    const waveform = toWaveForm(audioBuffer, numBars);
    let consecutiveNumSilences = 0;
    for (let idx = waveform.length - 1; idx >= 0; idx--) {
      if (waveform[idx] < 0.01) {
        consecutiveNumSilences++;
      } else {
        if (consecutiveNumSilences > 6) {
          goodPickups.push(idxToTime(idx + 2));
        }
        consecutiveNumSilences = 0;
      }
    }
    goodPickups.push(0);
    goodPickups.reverse();
    return goodPickups;
  }

  async goToPrevPause() {
    const noise = 200;
    const pickups = await this._computeGoodPickups();
    const currTime = this.getCurrTime();
    for (let idx = 0; idx < pickups.length; idx++) {
    if (pickups[idx] + noise > currTime) {
        this.setCurrTime(idx > 0 ? pickups[idx - 1] : 0);
        return;
      }
    }
    this.setCurrTime(pickups[pickups.length - 1]);
  }

  async goToNextPause() {
    const noise = 200;
    const pickups = await this._computeGoodPickups();
    const currTime = this.getCurrTime();
    for (let idx = 0; idx < pickups.length; idx++) {
      if (pickups[idx] - noise > currTime) {
        this.setCurrTime(pickups[idx]);
        return;
      }
    }
    this.setCurrTime(this.getTimeLength());
  }

  async _reloadAssets() {
    this._downloader.reload(this.getBlob());
    // this._reportMissingPointerTime();
    // TODO for long recordings, use getAudioBufferInWindow
    // Also, this getAudioBuffer call should be shared with computeWaveForm.
    const audioBufferCache = await this.getCachedAudioBufferInWindow();
    this._replayer.reload(audioBufferCache.content);
    // Redraw wave form.
    this._pointerChangePub(this.getCurrTime(true), /* ignoreTheLock */ true);
  }

  _reportMissingPointerTime() {
    const inaccurate = this._pointerTimes.filter(time => {
      return !time.isAccurate;
    });
    if (inaccurate.length > 5) {
      console.warn(inaccurate, this._pointerTimes);
    }
  }

  // Resume if not at the end.
  startReplaying() {
    let timeMs = 0;
    if (this._chunkPointerIdx != this.getChunkLength()) {
      timeMs = this.getCurrTime();
    }
    this._replayer.play(timeMs);
  }

  async pauseReplaying() {
    await this._replayer.pause();
  }

  isReplaying() {
    return this._replayer.isPlaying();
  }

  getChunkLength() {
    return this._getChunks().length;
  }

  async startRecording() {
    this.prepareToRecord();
    await this._audioRecorder.start();
  }

  prepareToRecord() {
    this.trimRight(true);
    const chunkLen = this.getChunkLength();
    this._startIndices = this._startIndices.filter(idx => {
      return idx < chunkLen;
    });
    this._startIndices.push(chunkLen);
  }

  async trimRight(skipReload) {
    const chunks = this._getChunks();
    if (chunks.length == this._chunkPointerIdx) {
      return;
    }
    this._state.setChunks(chunks.slice(0, this._chunkPointerIdx));
    if (skipReload) {
      return;
    }
    await this._reloadAssets();
  }

  async stopRecording() {
    await this._audioRecorder.stop();
  }

  isRecording() {
    return this._audioRecorder.isRecording();
  }

  getCurrTime(warnIfInaccurate) {
    return this._idxToTime(this._chunkPointerIdx, warnIfInaccurate);
  }

  setCurrTime(timeMs) {
    this._setChunkPointerIdxAndPub(this._timeToIdx(timeMs), /* warnIfInaccurate */ true);
  }

  getTimeLength() {
    return this._idxToTime(this.getChunkLength());
  }

  async getCachedAudioBufferInWindow(startTime) {
    startTime = startTime || 0;
    await this._audioBufferCache.loadAudioBuffer(this, startTime, this.getTimeLength());
    return this._audioBufferCache;
  }

  async getAudioBufferInWindow(startTime) {
    const res = this._getBlobInWindow(startTime);
    const buffer = await res.blob.arrayBuffer();
    // Note that this can error out when res.chunks.length < 2 due to decodeAudioData magic.
    const audioBuffer = await this._audioCtx.decodeAudioData(buffer);
    res.content = audioBuffer;

    // Hack: update pointerTimes here to save computing resources.
    // TODO: move this elsewhere, so we are not tied to computeWaveForm
    // to call this at the right time; e.g. use insert a audioBufferPubSub proxy between
    // pointerChangeSub and computeWaveForm.
    const pointerIdxToUpdate = res.goodStartIdx + res.chunks.length;
    
    const knownTimeIdx = this._pointerTimes.length - 1;
    const knownTime = this._pointerTimes[knownTimeIdx].chunkStartTime;
    for (let idx = this._pointerTimes.length; idx <= pointerIdxToUpdate; idx++) {
      this._pointerTimes.push(new PointerTime(knownTime + (idx - knownTimeIdx) * this._msPerChunk));
    }
    this._pointerTimes[pointerIdxToUpdate] = new PointerTime(
      audioBuffer.duration * 1000 + res.actualStartTime,
      /* isAccurate */ true,
    );
    return res;
  }

  getBlob() {
    const chunks = this._getChunks();
    return this._toBlob(chunks);
  }

  _getBlobInWindow(startTime) {
    const res = this._getChunksInWindow(startTime);
    res.blob = this._toBlob(res.chunks);
    return res;
  }
 
  _getGoodIdx(startIdx) {
    let goodIdx = 0;
    for (let possIdx of this._startIndices) {
      if (possIdx <= startIdx) {
        goodIdx = possIdx;
      } else {
        break;
      }
    };
    return goodIdx;
  }

  _getChunksInWindow(startTime) {
    const chunks = this._state.getChunks();
    const startIdx = isNaN(startTime) ? 0 : this._timeToIdx(startTime);
    const goodStartIdx = this._getGoodIdx(startIdx);
    const actualStartTime = this._idxToTime(goodStartIdx);
    const endIdx = this.getChunkLength();
    const res = chunks.slice(goodStartIdx, endIdx);
    if (res.length == 0) {
      throw 'Empty chunks for the given time window';
    }
    return {
      chunks: res,
      actualStartTime: actualStartTime,
      goodStartIdx: goodStartIdx,
    };
  }

  _getChunks() {
    return this._state.getChunks();
  }

  _setChunkPointerIdxAndPub(wantIdx, warnIfInaccurate) {
    this._chunkPointerIdx = this._ensureIdxInRange(wantIdx);
    this._pointerChangePub(this.getCurrTime(warnIfInaccurate));
  }

  _idxToTime(idx, warnIfInaccurate) {
    if (idx < 0 ) {
      // if (warnIfInaccurate) {
      //   console.warn('inaccurate time due to index out of bound', this._pointerTimes.length, idx);
      // }
      return idx * this._msPerChunk;
    }

    if (idx < this._pointerTimes.length) {
      const pointerTime = this._pointerTimes[idx];
      // if (warnIfInaccurate && !pointerTime.isAccurate) {
      //   console.warn('inaccurate time', idx);
      // }
      return pointerTime.chunkStartTime;
    }

    const knownTimeIdx = this._pointerTimes.length - 1;
    const knownTime = this._pointerTimes[knownTimeIdx].chunkStartTime;
    return knownTime + (idx - knownTimeIdx) * this._msPerChunk;
  }

  _timeToIdx(timeMs) {
    let wantIdx = roughBinarySearch(this._pointerTimes, timeMs, pointerTime => {
      return pointerTime.chunkStartTime;
    });
    // See if we need to round up instead of down.
    if (wantIdx + 1 < this._pointerTimes.length) {
      const leftDiff = Math.abs(timeMs - this._pointerTimes[wantIdx].chunkStartTime);
      const rightDiff = Math.abs(timeMs - this._pointerTimes[wantIdx+1].chunkStartTime);
      if (rightDiff < leftDiff) {
        wantIdx = wantIdx + 1;
      }
    }

    return this._ensureIdxInRange(wantIdx);
  }

  _ensureIdxInRange(wantIdx) {
    if (wantIdx < 0) {
      wantIdx = 0;
    }
    if (wantIdx > this.getChunkLength()) {
      wantIdx = this.getChunkLength();
    }
    return wantIdx;
  }

  _toBlob(chunks) {
    return new Blob(chunks, { type: this._mimeType });
  }
}


class PointerTime {
  constructor(chunkStartTime, isAccurate) {
    this.chunkStartTime = chunkStartTime;
    this.isAccurate = isAccurate;
  }
}

function roughBinarySearch(items, value, itemToValFunc){
  if (items.length == 0) {
    return 0;
  }
  var firstIndex  = 0,
      lastIndex   = items.length - 1,
      middleIndex = Math.floor((lastIndex + firstIndex)/2);
  itemToValFunc = itemToValFunc || (val => { return val; });

  while(middleIndex < items.length && firstIndex < lastIndex) {
    if (itemToValFunc(items[middleIndex]) == value) {
      break;
    }
    if (value < itemToValFunc(items[middleIndex])) {
      lastIndex = middleIndex - 1;
    } else if (value > itemToValFunc(items[middleIndex])) {
      firstIndex = middleIndex + 1;
    }
    middleIndex = Math.floor((lastIndex + firstIndex)/2);
}
  return Math.max(0, middleIndex);
}

class AudioBufferCache {
  constructor() {
     this.content = null;
     this.actualStartTime = 0;
     this.actualEndTime = 0;
     this.chunkLen = 0;
  }
  async loadAudioBuffer(stateMgr, startTime, endTime) {
    startTime = Math.max(0, startTime);
    // The cached version is sufficient; no need to load.
    const currChunkLen = stateMgr.getChunkLength();
    if (this.content && this.actualStartTime - 1 <= startTime && endTime <= this.actualEndTime + 1 && this.chunkLen == currChunkLen) {
      return;
    }
    const s = Date.now();
    const bufRes = await stateMgr.getAudioBufferInWindow(startTime);
    console.log('duration', (Date.now() - s) / 1000);

    this.content = bufRes.content;
    this.actualStartTime = bufRes.actualStartTime;
    this.actualEndTime = bufRes.actualStartTime + bufRes.content.duration * 1000;
    this.chunkLen = currChunkLen;
  }
}
