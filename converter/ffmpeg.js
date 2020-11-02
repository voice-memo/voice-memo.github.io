
export class WebmToMp3Converter {
  constructor() {
    // Lazy loading.
    this._worker = null;
    this._workerIsBusy = false;
    this._resolveFuncForWorkDone = null;
    this._errFuncForWorkDone = null;
    this._result = null;
  }

  // Returns: the resulting Uint8Array buffer view.
  async toMp3(uint8ArrayBufferView, inputFormat) {
    inputFormat = inputFormat || 'webm';
    const inputFileName = `audio.${inputFormat}`;
    // const args = `-i ${inputFileName} -c:v mpeg4 -b:v 6400k -strict experimental output.mp4`;
    const args= `-i ${inputFileName} -b:a 192K -vn out.mp3`;
    // const args= '-help';
    await this._postMessage({
      type: 'run',
      arguments: args.split(' '),
      MEMFS: [
          {
              data: uint8ArrayBufferView,
              name: inputFileName,
          }
      ]
    });
    return this._getResult();
  }

  async concatMp3(mp3BufferViews) {
    const inputPaths = mp3BufferViews.map((_, idx) => {
      return `file '${idx}.mp3'\n`;
    });
    const inputPathsBlob = new Blob(inputPaths);
    const arrayBuffer = await inputPathsBlob.arrayBuffer();
    const inputPathsView = new Uint8Array(arrayBuffer);
    const inputPathsPath = 'inputPaths.txt'
    const args = `-f concat -i ${inputPathsPath} -c copy output.mp3`;
    const fsArgs = mp3BufferViews.map((view, idx) => {
      return {
        data: view,
        name: `${idx}.mp3`
      }
    });
    await this._postMessage({
      type: 'run',
      arguments: args.split(' '),
      MEMFS: fsArgs.concat({
        data: inputPathsView,
        name: inputPathsPath,
      }),
    });
    return this._getResult();

  }

  async mp3ToMp4(mp3BufferView, jpegBufferView, durationMs) {
    const inputFileName = 'audio.mp3';
    const jpegFileName = '1.jpg';
    const durationSec = durationMs / 1000;
    let frameRate = 1;
    for (let exp = 2; exp < 9; exp++) {
      const granularity = Math.pow(10, exp);
      frameRate = Math.floor(granularity / durationSec) / granularity;
      if (Math.abs(durationSec - 1 / frameRate) < 1) {
        break;
      }
    }
    const args= `-framerate ${frameRate} -i 1.jpg -i ${inputFileName} out.mp4`;
    await this._postMessage({
      type: 'run',
      arguments: args.split(' '),
      MEMFS: [
          {
              data: mp3BufferView,
              name: inputFileName,
          },
          {
            data: jpegBufferView,
            name: jpegFileName,
        },
      ]
    });
    return this._getResult();
  }

  async getVersion() {
    await this._postMessage({type: "run", arguments: ["-version"]});
    return this._result;
  }
  async _postMessage(msg) {
    if (!this._worker) {
      await this._setup();
    }
    if (this._workerIsBusy) {
      console.log('worker is busy.')
      return;
    }
    this._workerIsBusy = true;
    const promiseToFinish = new Promise((resolve, err) => {
      this._resolveFuncForWorkDone = resolve;
      this._errFuncForWorkDone = err;
    });
    console.log('Executing', msg);
    this._worker.postMessage(msg);
    return promiseToFinish;
  }

  _getResult() {
    return this._result.MEMFS[0].data;
  }

  async _setup() {
    let resolveFuncForReady;
    const promiseToBeReady = new Promise(resolve => {
      resolveFuncForReady = resolve;
    });
    // Using mp4 because that's the desired output/encoding format.
    // Source code: https://unpkg.com/ffmpeg.js@4.2.9003/ffmpeg-worker-mp4.js.
    // this._worker = new Worker("../lib/ffmpeg-worker-webm.js");
    this._worker = new Worker("../lib/ffmpeg-worker-mp4.js");
    this._worker.onmessage = e => {
      const msg = e.data;
      switch (msg.type) {
      case "ready":
        resolveFuncForReady();
        console.log('converter is ready');
        break;
      case "done":
        console.log(msg.type, msg.data);
        this._result = msg.data;
        this._resolveFuncForWorkDone();
        this._workerIsBusy = false;
        break;
      case "error":
        this._errFuncForWorkDone(msg.data);
        this._workerIsBusy = false;
        break;
      default:
        console.log(msg.type, ':', msg.data);
        break;

      }
    };
    return promiseToBeReady;
  }
}

// TODO parse the time= part to measure and display progress.
// stderr : frame=    1 fps=0.0 q=0.0 size=   15104kB time=00:16:21.15 bitrate= 126.1kbits/s speed= 5.3x  
