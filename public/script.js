// create a short-lived developer token for the purpose of getting a longer-lived user token
fetch('/generate-music-token')
.then(r => r.json())
.then(data => {
  const token = data.token
  const music = MusicKit.configure({
    developerToken: token,
    app: {
      name: 'Apple Music Slack Status',
      version: '1.0.0'
    }
  })
  document.getElementById('auth').addEventListener('click', () => {
    music.authorize().then(musicUserToken => {
      const slackToken = window.location.href.split('=')[1].split('&')[0]
      const userId = window.location.href.split('=')[2]

      fetch('/register-new-user', {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slackToken,
          slackID: userId,
          musicToken: musicUserToken
        })
      }).then(() => {
        console.log(`Authorized! 😎`)
        window.location.href = '/auth-success.html'
      })
    })
  })
})