import { accountsDeps, type AccountsPagesContext } from '../../../server/accounts/deps'
import { handleCallback } from '../../../server/accounts/authHandlers'

export const onRequestGet = (ctx: AccountsPagesContext): Promise<Response> => handleCallback(ctx.request, accountsDeps(ctx.env))
