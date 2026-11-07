import { accountsDeps, type AccountsPagesContext } from '../../../server/accounts/deps'
import { handleSession } from '../../../server/accounts/authHandlers'

export const onRequestPost = (ctx: AccountsPagesContext): Promise<Response> => handleSession(ctx.request, accountsDeps(ctx.env))
