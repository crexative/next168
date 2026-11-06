import { deps, type PagesContext } from '../../../server/google/deps'
import { handleDisconnect } from '../../../server/google/handlers'

export const onRequestPost = (ctx: PagesContext): Promise<Response> => handleDisconnect(ctx.request, deps(ctx.env))
