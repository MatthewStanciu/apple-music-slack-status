const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const jwt = require('jsonwebtoken')
const fetch = require('node-fetch')
const { WebClient } = require('@slack/web-api')
const slack = new WebClient(process.env.SLACK_USER_TOKEN)
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

app.use(express.static('public'))
app.use(bodyParser.urlencoded({extended: true}))
app.use(bodyParser.json())

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html')
})

app.get('/music', (req, res) => {
  res.sendFile(__dirname + '/public/music.html')
})

app.get('/slack-auth', (req, res) => {
  const code = req.query.code
  slack.oauth.v2.access({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    code,
    grant_type: 'authorization_code'
  }).then(r => {
    const userId = r.authed_user.id
    const authToken = r.authed_user.access_token
    res.redirect(`/music?slack_token=${authToken}&userId=${userId}`)
  })
})

app.post('/slack/commands', async (req, res) => {
  // This is a bad idea because I don't verify that the request is coming from Slack, so somebody can spoof the command and toggle the bot on/off for other people. But this app doesn't do anything important, so I've decided to simply not deal with it. :cooll-thumbs:
  const { user_id, response_url } = req.body
  const appUser = await prisma.user.findUnique({
    where: { slackID: user_id }
  })
  await prisma.user.update({
    where: { slackID: user_id },
    data: {
      enabled: !appUser.enabled
    }
  })
  fetch(response_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: appUser.enabled ? `Toggled off! I won't update your status until you toggle me back on.` : `Toggled on! I will continuously update your status until you toggle me off.`,
      response_type: 'ephemeral'
    })
  }).then(() => res.status(200).end())
})

app.get('/generate-music-token', (req, res) => {
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY
  const teamId = process.env.TEAM_ID
  const keyId = process.env.KEY_ID

  const token = jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    expiresIn: '20s',
    issuer: teamId,
    header: {
      alg: 'ES256',
      kid: keyId
    }
  })

  res.send(JSON.stringify({ token }))
})

app.post('/register-new-user', async (req, res) => {
  const slackToken = req.body.slackToken
  const slackID = req.body.slackID
  const musicToken = req.body.musicToken

  if (!(await prisma.user.findUnique({
    where: { slackID }
  }))) {
    await prisma.user.create({
      data: {
        slackID,
        slackToken,
        appleMusicToken: musicToken,
        currentSong: '',
        playing: false,
        enabled: true
      }
    }).then(async () => {
      const users = await prisma.user.findMany()
      console.log(users)
      res.status(200).end()
    })
  } else {
    console.log('User already exists in database!')
    res.status(200).end()
  }
})

const updateStatus = async (user) => {
  console.log('updating status for', user)
  const playStatus = await getPlayStatus(user)
  const latest = await fetchLatestSong(user)
  let currentSong = await getCurrentSong(user)
  let latestSong = `${latest.artistName} - ${latest.name}`
  console.log(latestSong, currentSong, playStatus)

  if (latestSong === currentSong && !playStatus) {
    console.log('Not playing — skipping')
    return
  }

  if (latestSong !== currentSong) {
    setCurrentSong(latestSong, user)
    if (!playStatus) {
      setPlayStatus(true, user)
    }
    setTimeout(async () => {
      // You can't get the currently playing song for a user with the Apple Music API 🤦 This is a hacky workaround.
      // Set a timeout that lasts the duration of the currently-playing song. If the song has ended and the most recently-played song is still the same, assume the user is no longer playing music.
      // This breaks if the user is playing a song on repeat, or paused it for a while and comes back later, but I think it's the best I can do given the limitations of the Apple Music API.
      const newLatest = await fetchLatestSong(user)
      const newLatestSong = `${newLatest.artistName} - ${newLatest.name}`
      console.log(latestSong, newLatestSong)
      if (newLatestSong === latestSong) {
        console.log('Not playing')
        setPlayStatus(false, user)
      }
    }, latest.durationInMillis + 5000)
  }

  // set user's slack status
  const slackToken = await getSlackToken(user)
  fetch('https://slack.com/api/users.profile.set', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${slackToken}`,
    },
    body: JSON.stringify({
      profile: {
        status_text: !playStatus ? '' : currentSong,
        status_emoji: !playStatus ? '' : ':applemusic:',
        status_expiration: latest.durationInMillis
      }
    })
  })
}

const fetchLatestSong = (slackID) => (
  new Promise((resolve, reject) => {
    prisma.user.findUnique({
      where: { slackID }
    }).then(user => {
      const musicUserToken = user.appleMusicToken
      fetch('https://api.music.apple.com/v1/me/recent/played/tracks', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.DEVELOPER_TOKEN}`,
          'Music-User-Token': musicUserToken
        }
      })
      .then(r => r.json())
      .then(data => {
        resolve(data.data[0].attributes)
      })
      .catch(err => {
        console.error(`could not fetch latest song for ${slackID}`, err)
        reject(err)
      })
    })
  })
)

const getCurrentSong = async (slackID) => {
  const user = await prisma.user.findUnique({
    where: { slackID }
  })
  return user.currentSong
}

const setCurrentSong = async (song, slackID) => {
  await prisma.user.update({
    where: { slackID },
    data: {
      currentSong: song
    }
  })
}

const getPlayStatus = async (slackID) => {
  const user = await prisma.user.findUnique({
    where: { slackID }
  })
  return user.playing
}

const setPlayStatus = async (status, slackID) => {
  await prisma.user.update({
    where: { slackID },
    data: {
      playing: status
    }
  })
}

const getSlackToken = async (slackID) => {
  const user = await prisma.user.findUnique({
    where: { slackID }
  })
  return user.slackToken
}

const updateStatuses = async () => {
  const users = await prisma.user.findMany().catch(err => console.log('error connecting', err))
  // console.log(users)
  for (let user of users) {
    if (user.enabled) {
      updateStatus(user.slackID)
    } else {
      console.log(`User ${user.slackID} is not enabled. Skipping.`)
    }
  }
}

setInterval(() => {
  updateStatuses()
}, 5000)

app.listen(process.env.PORT || 3000)