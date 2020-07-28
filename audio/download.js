
export class Downloader {
  constructor(microphoneRecordingsHtml) {
    this._microphoneRecordingsHtml = microphoneRecordingsHtml;
    this._currUrl = null;
  }

  reload(blob, name) {
    // convert blob to URL so it can be assigned to a audio src attribute
    const oldUrl = this._currUrl;
    this._currUrl = URL.createObjectURL(blob);
    createAudioElement(this._currUrl, this._microphoneRecordingsHtml, name);
    // Wait a little before removing old url to avoid net::ERR_FILE_NOT_FOUND.
    window.setTimeout(_ => {
      URL.revokeObjectURL(oldUrl);
    }, 1000);
  }
}

// appends an audio element to playback and download recording
function createAudioElement(blobUrl, microphoneRecordingsHtml, name) {
  name = name || 'audio.webm';

  while (microphoneRecordingsHtml.firstChild) {
    microphoneRecordingsHtml.removeChild(microphoneRecordingsHtml.firstChild);
  }
  
  // No need for download link because it appears in the audio overflow menu after hitting play.
  const downloadEl = document.createElement('a');
  downloadEl.id = 'download-link';
  downloadEl.style = 'display: block';
  downloadEl.innerHTML = `Download ${name} (cmd+s)`;
  downloadEl.download = name;
  downloadEl.href = blobUrl;
  microphoneRecordingsHtml.appendChild(downloadEl);

  document.getElementById('convert-to-mp4').style.display = 'inline';
}