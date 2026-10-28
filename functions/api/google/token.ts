import { deps, type PagesContext } from '../../../server/google/deps'
import { handleToken } from '../../../server/google/handlers'

export const onRequestPost = (ctx: PagesContext): Promise<Response> => handleToken(ctx.request, deps(ctx.env))
