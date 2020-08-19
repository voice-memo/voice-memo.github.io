import {RecordStateMgr} from './audio/manageState.js';
import * as pubSub from './utils/pubSub.js'
import * as banner from './utils/banner.js';
import { KeyboardShortcuts } from './keyboardShortcuts.js';
import { ActionMgr } from './actionMgr.js';
import { WaveFormDrawer } from './audio/drawWaveForm.js';
import { WaveFormMgr } from './audio/computeWaveForm.js';
import { MouseShortcuts } from './mouseShortcuts.js';


window.onload = _ => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContext({sampleRate: 44100});
  const [waveFormPub, waveFormSub] = pubSub.make();
  const [pointerChangePub, pointerChangeSub] = pubSub.make();
  const [recorderStoppedPub, recorderStoppedSub] = pubSub.make();
  const [audioChunkPub, audioChunkSub] = pubSub.make();

  const microphoneRecordingsHtml = document.getElementById('microphone-recordings');
  const currentTimeHtml = document.getElementById('current-time');
  pointerChangeSub(time => {
    currentTimeHtml.textContent = `${Math.floor(time / 100) / 10}s`;
  });

  const waveFormCanvas = document.getElementById('wave-form-canvas');
  const stateMgr = new RecordStateMgr(
    audioCtx, pointerChangePub, recorderStoppedPub, recorderStoppedSub,
    audioChunkPub, audioChunkSub,
    microphoneRecordingsHtml, waveFormCanvas);
  const eBanner = banner.setup();
  const actionMgr = new ActionMgr(eBanner, stateMgr);
  new KeyboardShortcuts(actionMgr);
  new MouseShortcuts(actionMgr);

  new WaveFormMgr(pointerChangeSub, stateMgr, waveFormPub);
  new WaveFormDrawer(waveFormSub, waveFormCanvas);

  // For debugging
  window.stateMgr = stateMgr;

  const fileInput = document.getElementById('audio-file-input');
  fileInput.onchange = async _ => {
    if (fileInput.files.length < 1) {
      return;
    }
    const blob = fileInput.files[0];
    console.log(blob.name);
    const fileNameParts = blob.name.split('.');
    stateMgr.setFileFormat(fileNameParts[fileNameParts.length - 1]);
    // This is a hack to upload by faking a recording process.
    await stateMgr.prepareToRecord();

    audioChunkPub(blob);
    // This is just a rough under-estimate; an over-estimate is bad due to impl detail.
    // const bytesPerMs = 4;
    // const msPerChunk = 200;
    // const bytesPerChunk = bytesPerMs * msPerChunk;
    // const numChunks = Math.ceil(blob.size / bytesPerChunk);
    // for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
    //   audioChunkPub(blob.slice(chunkIdx * bytesPerChunk, (chunkIdx + 1) * bytesPerChunk));
    // }

    recorderStoppedPub();
    fileInput.value = '';

  };

};






