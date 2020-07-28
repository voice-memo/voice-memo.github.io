
export class MouseShortcuts {
  constructor(actionMgr) {

    document.getElementById('microphone-record').onclick = _ => {
      actionMgr.pauseOrResumeRecording();
    }
    document.getElementById('preview-and-record').onclick = _ => {
      actionMgr.replayAndRecord();
    }
    document.getElementById('go-to-previous-pause').onclick = _ => {
      actionMgr.goToPrevPause();
    }
    document.getElementById('go-to-next-pause').onclick = _ => {
      actionMgr.goToNextPause();
    }
    document.getElementById('replay-recording').onclick = _ => {
      actionMgr.pauseOrResumeReplay();
    }
    document.getElementById('convert-to-mp4').onclick = _ => {
      actionMgr.downloadMp4();
    }
  }
}