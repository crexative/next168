import { deps, type PagesContext } from '../../../server/google/deps'
import { handleCallback } from '../../../server/google/handlers'

export const onRequestGet = (ctx: PagesContext): Promise<Response> => handleCallback(ctx.request, deps(ctx.env))
