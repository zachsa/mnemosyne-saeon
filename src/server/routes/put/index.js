import { KEY } from '../../../config/index.js'
import { createWriteStream, promises as fsPromises } from 'fs'
import { error } from '../../../logger/index.js'
import { mkdirp } from 'mkdirp'
import { dirname } from 'path'
import authenticate from '../../../lib/authenticate.js'

const { access, unlink } = fsPromises

export default async function handleUploadRequest() {
  const {
    req,
    res,
    resource: {
      _paths,
      url: { href },
    },
  } = this

  if (_paths.length !== 1) {
    const msg = 'Conflict. Ambiguous upload path specified (multiple volumes are mounted)'
    res.writeHead(409, msg, { 'Content-Type': 'text/plain' })
    res.write(msg)
    res.end()
    return
  }

  // Ensure that uploads are enabled for this server
  if (!KEY) {
    res.writeHead(405, { 'Content-Type': 'text/plain' })
    res.write('PUT has been disabled for this server')
    res.end()
    return
  }

  // Ensure that a valid token is used
  try {
    authenticate(req)
  } catch (e) {
    error(e)
    res.statusCode = 401
    res.write('Unauthorized')
    res.end()
    return
  }

  const { path } = _paths[0]

  // Check if the resource exists
  let exists
  try {
    await access(path)
    exists = true
  } catch {
    exists = false
  }

  // If it exists return 409
  if (exists) {
    const msg = 'Conflict. Upload path already exists'
    res.writeHead(409, msg, { 'Content-Type': 'text/plain' })
    res.write(msg)
    res.end()
    return
  }

  // Get upload path
  const dir = dirname(path)

  // Ensure dir exists
  await mkdirp(dir)

  // Stream file contents to disk
  const stream = createWriteStream(path)

  // Delete failed uploads
  stream.on('error', async err => {
    await unlink(path)
    error(err)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.write('Internal Server Error')
    res.end()
  })

  // Keep track of how much is received
  let received = 0
  req.on('data', chunk => {
    received += chunk.length
  })

  req.pipe(stream)

  // Handle aborted requests
  req.on('aborted', async () => {
    error('Connection terminated by client')
    await unlink(path)
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.write('Bad Request')
    res.end()
  })

  await new Promise(resolve => {
    stream.on('close', async () => {
      // Respond with new resource info
      const msg = `Received ${received} bytes`
      res.writeHead(201, {
        'Content-Type': 'text/plain',
        'Content-Location': href,
      })
      res.write(msg)
      res.end()
      resolve()
    })
  })
}
