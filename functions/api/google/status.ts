import { deps, type PagesContext } from '../../../server/google/deps'
import { handleStatus } from '../../../server/google/handlers'

export const onRequestPost = (ctx: PagesContext): Promise<Response> => handleStatus(ctx.request, deps(ctx.env))
