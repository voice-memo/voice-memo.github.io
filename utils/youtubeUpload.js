

// 1 - Film & Animation 
// 2 - Autos & Vehicles
// 10 - Music
// 15 - Pets & Animals
// 17 - Sports
// 18 - Short Movies
// 19 - Travel & Events
// 20 - Gaming
// 21 - Videoblogging
// 22 - People & Blogs
// 23 - Comedy
// 24 - Entertainment
// 25 - News & Politics
// 26 - Howto & Style
// 27 - Education
// 28 - Science & Technology
// 29 - Nonprofits & Activism
// 30 - Movies
// 31 - Anime/Animation
// 32 - Action/Adventure
// 33 - Classics
// 34 - Comedy
// 35 - Documentary
// 36 - Drama
// 37 - Family
// 38 - Foreign
// 39 - Horror
// 40 - Sci-Fi/Fantasy
// 41 - Thriller
// 42 - Shorts
// 43 - Shows
// 44 - Trailers


export async function uploadFile(file, accessToken, metadata, eBanner) {
  const uploadStartTime = Date.now();

  let resolveFuncForUpload;
  let rejectFuncForUpload;
  const promiseToUpload = new Promise((resolve, reject) => {
    resolveFuncForUpload = resolve;
    rejectFuncForUpload = reject;
  });
  var uploader = new MediaUploader({
    baseUrl: 'https://www.googleapis.com/upload/youtube/v3/videos',
    file: file,
    token: accessToken,
    metadata: metadata,
    params: {
      part: Object.keys(metadata).join(',')
    },
    onError: data => {
      let message = data;
      // Assuming the error is raised by the YouTube API, data will be
      // a JSON string with error.message set. That may not be the
      // only time onError will be raised, though.
      try {
        const errorResponse = JSON.parse(data);
        message = errorResponse.error.message || data;
      } finally {
        rejectFuncForUpload(message);
      }
    },
    onProgress: data => {
      var currentTime = Date.now();
      var bytesUploaded = data.loaded;
      var totalBytes = data.total;
      // The times are in millis, so we need to divide by 1000 to get seconds.
      var bytesPerSecond = bytesUploaded / ((currentTime - uploadStartTime) / 1000);
      var estimatedSecondsRemaining = (totalBytes - bytesUploaded) / bytesPerSecond;
      var percentageComplete = (bytesUploaded * 100) / totalBytes;
      eBanner.inProgress(`${percentageComplete}% uploaded. ${estimatedSecondsRemaining}s remaining.`);
    },
    onComplete: data => {
      var uploadResponse = JSON.parse(data);
      const videoId = uploadResponse.id;
      resolveFuncForUpload(videoId);
      // $('#video-id').text(`www.youtube.com/watch?v=${this.videoId}`);
      // $('.post-upload').show();
    },
  });
  // This won't correspond to the *exact* start of the upload, but it should be close enough.
  uploader.upload();
  return promiseToUpload;
}

// export function pollForVideoStatus(videoId, eBanner) {
//   const STATUS_POLLING_INTERVAL_MILLIS = 20 * 1000; // 20 seconds.
//   gapi.client.request({
//     path: '/youtube/v3/videos',
//     params: {
//       part: 'status,player',
//       id: videoId
//     },
//     callback: response => {
//       if (response.error) {
//         // The status polling failed.
//         eBanner.failure(response.error.message);
//         setTimeout(pollForVideoStatus.bind(this), STATUS_POLLING_INTERVAL_MILLIS);
//       } else {
//         var uploadStatus = response.items[0].status.uploadStatus;
//         switch (uploadStatus) {
//           // This is a non-final status, so we need to poll again.
//           case 'uploaded':
//             eBanner.inProgress('Upload status: ' + uploadStatus);
//             setTimeout(_ => {
//               pollForVideoStatus(videoId, eBanner);
//             }, STATUS_POLLING_INTERVAL_MILLIS);
//             break;
//           // The video was successfully transcoded and is available.
//           case 'processed':
//             eBanner.success('Processed');
//             break;
//           // All other statuses indicate a permanent transcoding failure.
//           default:
//             eBanner.failure('Transcoding failed.');
//             break;
//         }
//       }
//     }
//   });
// }