import express from 'express'
import bodyParser from 'body-parser'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import jwt from 'jsonwebtoken'
import fetch from 'node-fetch'
import { WebClient } from '@slack/web-api'
import pkg from '@prisma/client'
const { PrismaClient } = pkg
import { ToadScheduler, SimpleIntervalJob, AsyncTask } from 'toad-scheduler'

const app = express()
const prisma = new PrismaClient()
const slack = new WebClient(process.env.SLACK_USER_TOKEN)

app.use(express.static('public'))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

app.get('/', (req, res) => {
  res.sendFile(path.join(dirname(fileURLToPath(import.meta.url)), 'public/index.html'))
})

app.get('/music', (req, res) => {
  res.sendFile(path.join(dirname(fileURLToPath(import.meta.url)), 'public/music.html'))
})

app.get('/slack-auth', (req, res) => {
  const code = req.query.code
  slack.oauth.v2
    .access({
      client_id: `${process.env.CLIENT_ID}`,
      client_secret: `${process.env.CLIENT_SECRET}`,
      code: `${code}`,
      grant_type: 'authorization_code',
    })
    .then((r) => {
      const userId = r.authed_user?.id
      const authToken = r.authed_user?.access_token
      res.redirect(`/music?slack_token=${authToken}&userId=${userId}`)
    })
})

app.post('/slack/commands', async (req, res) => {
  // This is a bad idea because I don't verify that the request is coming from Slack, so somebody can spoof the command and toggle the bot on/off for other people. But this app doesn't do anything important, so I've decided to simply not deal with it. :cooll-thumbs:
  const { user_id, response_url } = req.body
  const appUser = await prisma.user.findUnique({
    where: { slackID: user_id },
  })
  await prisma.user.update({
    where: { slackID: user_id },
    data: {
      enabled: !appUser?.enabled,
    },
  })
  fetch(response_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: appUser?.enabled
        ? `Toggled off! I won't update your status until you toggle me back on.`
        : `Toggled on! I will continuously update your status until you toggle me off.`,
      response_type: 'ephemeral',
    }),
  }).then(() => res.status(200).end())
})

app.get('/generate-music-token', (req, res) => {
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY
  const teamId = process.env.TEAM_ID
  const keyId = process.env.KEY_ID

  const token = jwt.sign({}, privateKey as string, {
    algorithm: 'ES256',
    expiresIn: '20s',
    issuer: teamId,
    header: {
      alg: 'ES256',
      kid: keyId,
    },
  })

  res.send(JSON.stringify({ token }))
})

app.post('/register-new-user', async (req, res) => {
  const slackToken = req.body.slackToken
  const slackID = req.body.slackID
  const musicToken = req.body.musicToken

  if (
    !(await prisma.user.findUnique({
      where: { slackID },
    }))
  ) {
    await prisma.user
      .create({
        data: {
          slackID,
          slackToken,
          appleMusicToken: musicToken,
          currentSong: '',
          playing: false,
          enabled: true,
        },
      })
      .then(async () => {
        const users = await prisma.user.findMany()
        console.log(users)
        res.status(200).end()
      })
  } else {
    console.log('User already exists in database!')
    res.status(200).end()
  }
})

const updateStatus = async (user: string) => {
  console.log('updating status for', user)
  const playStatus = await getPlayStatus(user)
  const latest = (await fetchLatestSong(user)) as AppleMusicSong
  let currentSong = await getCurrentSong(user)
  let latestSong = `${latest.artistName} – ${latest.name}`
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
      const newLatest = (await fetchLatestSong(user)) as AppleMusicSong
      const newLatestSong = `${newLatest.artistName} — ${newLatest.name}`
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
        status_expiration: latest.durationInMillis,
      },
    }),
  })
}

const fetchLatestSong = (slackID: string): Promise<AppleMusicSong | string> =>
  new Promise((resolve, reject) => {
    prisma.user
      .findUnique({
        where: { slackID },
      })
      .then((user) => {
        if (user === null)
          reject(`Could not fetch latest song for ${slackID}: user is null`)
        else {
          const musicUserToken = user.appleMusicToken
          fetch('https://api.music.apple.com/v1/me/recent/played/tracks', {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${process.env.DEVELOPER_TOKEN}`,
              'Music-User-Token': musicUserToken,
            },
          })
            .then((r: any) => r.json())
            .then((data: LatestSongResponse) => {
              resolve(data.data[0].attributes)
            })
            .catch((err: Error) => {
              console.error(`could not fetch latest song for ${slackID}`, err)
              reject(err)
            })
        }
      })
  })

const getCurrentSong = async (slackID: string): Promise<string> => {
  const user = await prisma.user.findUnique({
    where: { slackID },
  })
  if (user !== null) return user.currentSong
  else return ''
}

const setCurrentSong = async (song: string, slackID: string) => {
  await prisma.user.update({
    where: { slackID },
    data: {
      currentSong: song,
    },
  })
}

const getPlayStatus = async (slackID: string): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { slackID },
  })
  if (user !== null) return user.playing
  else return false
}

const setPlayStatus = async (status: boolean, slackID: string) => {
  await prisma.user.update({
    where: { slackID },
    data: {
      playing: status,
    },
  })
}

const getSlackToken = async (slackID: string): Promise<string> => {
  const user = await prisma.user.findUnique({
    where: { slackID },
  })
  if (user !== null) return user.slackToken
  else return ''
}

const updateStatuses = async () => {
  const users = (await prisma.user
    .findMany()
    .catch((err) => console.log('error connecting', err))) as User[]
  // console.log(users)
  for (let user of users) {
    if (user.enabled) {
      updateStatus(user.slackID)
    } else {
      console.log(`User ${user.slackID} is not enabled. Skipping.`)
    }
  }
}

const scheduler = new ToadScheduler()
const updateStatusesTask = new AsyncTask(
  'update statuses',
  updateStatuses,
  (err: Error) => {
    console.error(`Error in task: ${err}`)
  },
)
const job = new SimpleIntervalJob({ seconds: 5 }, updateStatusesTask)
scheduler.addSimpleIntervalJob(job)

app.listen(process.env.PORT || 3000)
