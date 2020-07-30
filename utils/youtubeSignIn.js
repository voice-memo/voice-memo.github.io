let isSignedIn = false; // Google Auth object.

// Returns the access token.
export async function signIn() {
  if (isSignedIn) {
    return;
  }
  let resolveFuncForSignIn;
  const promiseToSignIn = new Promise(resolve => {
    resolveFuncForSignIn = resolve;
  });
  gapi.load('client:auth2', _ => {

    gapi.client.init({
      // 'apiKey': 'AIzaSyAGsJNLI2f1se1rlzJtW-utT-1eMNv1rQ8',
      clientId: '100329775356-u7kat23hhdob8oq1o37ji3j10ljjgj4a.apps.googleusercontent.com',
      // 'clientId': '217779582665-336qrao92rt8n0v17ers8f5eo43t8q7l.apps.googleusercontent.com',
      'scope': [
        // For uploading.
        'https://www.googleapis.com/auth/youtube.upload',
        // // For adding item to playlist.
        // 'https://www.googleapis.com/auth/youtubepartner',
      ].join(' '),
      'discoveryDocs': ['https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest']
    }).then(function () {
        const GoogleAuth = gapi.auth2.getAuthInstance();
        // Trigger the sign in.
        GoogleAuth.signIn().then(_ => {
          const currUser = GoogleAuth.currentUser.get();
          const authResponse = currUser.getAuthResponse(true);
          console.log('authResponse after sign in', authResponse);
          resolveFuncForSignIn(authResponse.access_token);
        })
    });
  });
  return promiseToSignIn;

}

export async function upload(videoBlob, args={}) {
  return await postData('https://www.googleapis.com/upload/youtube/v3/videos');
}

// Example POST method implementation:
async function postData(url = '', data = {}) {
  // Default options are marked with *
  const response = await fetch(url, {
    method: 'POST', // *GET, POST, PUT, DELETE, etc.
    mode: 'no-cors', // no-cors, *cors, same-origin
    cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
    credentials: 'same-origin', // include, *same-origin, omit
    headers: {
      'Content-Type': 'application/json'
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: 'follow', // manual, *follow, error
    referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify(data) // body data type must match "Content-Type" header
  });
  return response.json(); // parses JSON response into native JavaScript objects
}

// postData('https://example.com/answer', { answer: 42 })
//   .then(data => {
//     console.log(data); // JSON data parsed by `data.json()` call
//   });