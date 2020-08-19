import * as pubSub from '../utils/pubSub.js'
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
    audioChunkPub, audioChunkSub, microphoneRecordingsHtml, waveFormCanvas) {
    this._audioCtx = audioCtx;
    this._waveFormCanvas = waveFormCanvas;
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
    this._startIndices = [0];
    this._audioBufferBuilder = new AudioBufferBuilder(audioCtx);
    this._audioBufferBuilderChunkLen = 0;
    this._converter = new WebmToMp3Converter();
    this._audioBufferReloadQueue = [];

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
      const blob = this._toBlob(chunks.slice(startIdx, endIdx));
      const bufferView = await _toBufferView(blob);
      mp3BufferViews.push(await this._converter.toMp3(await bufferView, this._fileFormat));
    }
    return await this._converter.concatMp3(mp3BufferViews);
  }

  async convertToMp4(mp3BufferView, jpegBlob) {
    const imageBufferView = await _toBufferView(jpegBlob);
    const mp4BufferView = await this._converter.mp3ToMp4(mp3BufferView, imageBufferView, this.getTimeLength());
    return new Blob([mp4BufferView.buffer]);
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
    // const audioBufferCache = await this.getCachedAudioBufferInWindow();
    // const actualStartTime = audioBufferCache.actualStartTime;
    // const audioBuffer = audioBufferCache.content;
    const audioBuffer = await this.getAudioBuffer();
    const msPerBar = 100;
    const bufferDurationMs = audioBuffer.duration * 1000;
    const numBars = bufferDurationMs / msPerBar;
    const idxToTime = idx => {
      return idx * msPerBar;
      // return actualStartTime + idx * msPerBar;
    };
    const goodPickups = [];
    const waveform = toWaveForm(audioBuffer, numBars);
    let consecutiveNumSilences = 0;
    for (let idx = waveform.length - 1; idx >= 0; idx--) {
      console.log(waveform[idx]);
      if (waveform[idx] < 0.01) {
        consecutiveNumSilences++;
      } else {
        if (consecutiveNumSilences > 4) {
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

  atTail() {
    return this._chunkPointerIdx == this.getChunkLength();
  }

  async _reloadAudioBuffer() {
    while (true) {
      // Always reload the last of the start indices, because it may have been trimmed.
      if (this._audioBufferBuilder.getNumBuffers() < this._startIndices.length) {
        break;
      }
      this._audioBufferBuilder.pop();
    }
    for (let startIndicesIdx = this._audioBufferBuilder.getNumBuffers(); startIndicesIdx < this._startIndices.length; startIndicesIdx++) {
      const isFinal = startIndicesIdx + 1 == this._startIndices.length;
      const startIdx = this._startIndices[startIndicesIdx];
      const chunks = this._getChunks().slice(
        startIdx,
        isFinal ? this.getChunkLength() : this._startIndices[startIndicesIdx + 1]);
      const audioBuffer = await this._toAudioBuffer(this._toBlob(chunks));
      this._audioBufferBuilder.append(audioBuffer);

      if (isFinal) {
        this._updatePointerTimes(this.getChunkLength(), audioBuffer.duration * 1000, startIdx);
      }
    }
  }

  _updatePointerTimes(pointerIdxToUpdate, relativeDurationMs, startIdx) {
    const knownTimeIdx = this._pointerTimes.length - 1;
    const knownTime = this._pointerTimes[knownTimeIdx].chunkStartTime;
    for (let idx = this._pointerTimes.length; idx <= pointerIdxToUpdate; idx++) {
      this._pointerTimes.push(new PointerTime(knownTime + (idx - knownTimeIdx) * this._msPerChunk));
    }
    this._pointerTimes[pointerIdxToUpdate] = new PointerTime(
      relativeDurationMs + this._pointerTimes[startIdx].chunkStartTime,
      /* isAccurate */ true,
    );
  }

  async _reloadAssets() {
    this._downloader.reload(this.getBlob());
    // this._reportMissingPointerTime();
    this._replayer.reload(await this.getAudioBuffer());
    this._forceWaveformRedraw();
  }

  async getAudioBuffer() {
    if (this.getChunkLength() == this._audioBufferBuilderChunkLen) {
      return this._audioBufferBuilder.getAudioBuffer();
    }

    const promise = new Promise((resolve, err) => {
      this._audioBufferReloadQueue.push({resolve: resolve, err: err});
    });
    if (this._audioBufferReloadQueue.length > 1) {
      console.log('_audioBufferReloadQueue.length', this._audioBufferReloadQueue.length);
      return promise;
    }
    const startTime = Date.now();
    try {
      await this._reloadAudioBuffer();
    } catch (error) {
      this._audioBufferReloadQueue.forEach(resolveOrErr => {
        resolveOrErr.err(error);
      });
      this._audioBufferReloadQueue = [];
      throw error;
    }
    this._audioBufferBuilderChunkLen = this.getChunkLength();
    if (Math.random() < .02) {
      console.log('latency in ms', Date.now() - startTime);
    }

    this._audioBufferReloadQueue.forEach(resolveOrErr => {
      const audioBuffer = this._audioBufferBuilder.getAudioBuffer();
      resolveOrErr.resolve(audioBuffer);
    });
    this._audioBufferReloadQueue = [];
    return promise;
  }

  _forceWaveformRedraw() {
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
    this._waveFormCanvas.style.backgroundColor = 'maroon';
  }

  async prepareToRecord() {
    await this.trimRight(/*skipFullReload*/true);
    const chunkLen = this.getChunkLength();
    if (chunkLen > 0) {
      this._startIndices.push(chunkLen);
    }
  }

  async trimRight(skipFullReload) {
    const chunks = this._getChunks();
    if (chunks.length == this._chunkPointerIdx) {
      return;
    }
    
    this._state.setChunks(chunks.slice(0, this._chunkPointerIdx));
    const chunkLen = this.getChunkLength();
    // Keep the very first pointer Time and start index.
    this._pointerTimes = this._pointerTimes.slice(0, Math.max(1, chunkLen));
    this._startIndices = this._startIndices.filter(idx => {
      return idx < Math.max(1, chunkLen);
    });
    // If we are too close to the previous start index, need to continue trimming._
    if (this._chunkPointerIdx - 1 == this._startIndices[this._startIndices.length - 1]) {
      this._chunkPointerIdx = this._ensureIdxInRange(this._chunkPointerIdx - 1);
      this.trimRight(skipFullReload);
      return;
    }
    // Reload the buffers.
    await this.getAudioBuffer();
    if (skipFullReload) {
      return;
    }
    await this._reloadAssets(skipFullReload);
  }

  async stopRecording() {
    await this._audioRecorder.stop();
    this._waveFormCanvas.style.backgroundColor = 'black';
    // A hack to detect when things (e.g. _pointerTimes) are updated.
    await this.getAudioBuffer();
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

  getBlob() {
    const chunks = this._getChunks();
    return this._toBlob(chunks);
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

  _getChunks() {
    return this._state.getChunks();
  }

  _setChunkPointerIdxAndPub(wantIdx, warnIfInaccurate) {
    this._chunkPointerIdx = this._ensureIdxInRange(wantIdx);
    this._pointerChangePub(this.getCurrTime(warnIfInaccurate));
  }

  _idxToTime(idx, warnIfInaccurate) {
    if (idx <= 0 || this._pointerTimes.length == 0 ) {
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

  async _toAudioBuffer(blob) {
    const buffer = await blob.arrayBuffer();
    // Note that this can error out when res.chunks.length < 2 due to decodeAudioData magic.
    return await this._audioCtx.decodeAudioData(buffer);
  }
}

async function _toBufferView(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
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

class AudioBufferBuilder {
  constructor(audioCtx) {
    this._audioCtx = audioCtx;
    this._audioBuffers = [];
  }
  append(audioBuffer) {
    this._audioBuffers.push(audioBuffer);
  }
  pop() {
    this._audioBuffers.pop();
  }
  getNumBuffers() {
    return this._audioBuffers.length;
  }
  getAudioBuffer() {
    return mergeBuffers(this._audioCtx, this._audioBuffers);
  }
  reset() {
    this._audioBuffers = [];
  }

}

/**
 * Merge buffers, assuming numOfChannels are the same for all buffers,
 * with the sample rate being that of the audio context's.
 * https://stackoverflow.com/a/14148125/2191332
 * 
 */
function mergeBuffers(audioCtx, buffers) {
  if (buffers.length == 0) {
    return audioCtx.createBuffer(/*channels*/1, /*bufferLength*/1, audioCtx.sampleRate);
  }
  // let totalDuration = 0;
  let frameCounts = 0;
  for(let a=0; a<buffers.length; a++){
      // totalDuration += buffers[a].duration;// Get the total duration of the new buffer when every buffer will be added/concatenated
      frameCounts += buffers[a].getChannelData(0).length;
  }
  const numberOfChannels = buffers[0].numberOfChannels;
  // Note frameCounts == Math.ceil(audioCtx.sampleRate * totalDuration)
  const res = audioCtx.createBuffer(
    numberOfChannels, frameCounts, audioCtx.sampleRate);
  for (let b=0; b<numberOfChannels; b++) {
    let channel = res.getChannelData(b);
    let dataIndex = 0;
    
    for(let c = 0; c < buffers.length; c++) {
      channel.set(buffers[c].getChannelData(b), dataIndex);
      dataIndex+=buffers[c].length;// Next position where we should store the next buffer values
    }
  }
  return res;
}

