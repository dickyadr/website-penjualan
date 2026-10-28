import type { IncomingMessage, ServerResponse } from 'node:http'
import { app } from '../server.js'

export default function handler(request: IncomingMessage, response: ServerResponse) {
  const url = request.url || '/'
  if (url !== '/api' && !url.startsWith('/api/')) request.url = `/api${url}`
  return app(request, response)
}
