import { deps, type PagesContext } from '../../../server/google/deps'
import { handleConnect } from '../../../server/google/handlers'

export const onRequestPost = (ctx: PagesContext): Promise<Response> => handleConnect(ctx.request, deps(ctx.env))
