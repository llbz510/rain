// AC-SU-03 controlled HTTP input. Rain still executes its real fetch/SSE client.
// No model, live key or product renderer is provided by this fixture.
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'

const readyPath = process.argv[2]
if (!readyPath) throw new Error('Expected a temporary readiness file path')
const requests = []
let probeCount = 0
const token = (response, content) => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
  const url = new URL(request.url, 'http://localhost')
  if (request.method === 'GET' && url.pathname === '/status') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ probeCount, requests: requests.map(({ question, completed, aborted }) => ({ question, completed, aborted })) }))
    return
  }
  const release = /^\/release\/(\d+)\/(hidden|done)$/.exec(url.pathname)
  if (request.method === 'POST' && release) {
    const entry = requests[Number(release[1]) - 1]
    if (!entry || entry.completed || entry.aborted) { response.writeHead(409).end('No active request'); return }
    if (release[2] === 'hidden') token(entry.response, ' hidden')
    else { token(entry.response, ' complete'); entry.completed = true; entry.response.end('data: [DONE]\n\n') }
    response.end('released')
    return
  }
  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') { response.writeHead(404).end(); return }
  let raw = ''
  for await (const chunk of request) raw += chunk
  let body
  try { body = JSON.parse(raw) } catch { response.writeHead(400).end(); return }
  if (body.model !== 'rain-tabs-controlled' || body.stream !== true || !Array.isArray(body.messages)) {
    response.writeHead(400).end('Unexpected controlled request'); return
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  if (body.messages.some(message => message.content === 'Run the Rain text assistant capability check.')) {
    probeCount += 1
    token(response, 'RAIN_ASSISTANT_OK')
    response.end('data: [DONE]\n\n')
    return
  }
  const entry = { response, question: body.messages.at(-1)?.content, completed: false, aborted: false }
  requests.push(entry)
  response.on('close', () => { if (!entry.completed) entry.aborted = true })
  token(response, 'Visible')
})
server.listen(0, '127.0.0.1', async () => {
  await writeFile(readyPath, JSON.stringify({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, port: server.address().port }), 'utf8')
})
