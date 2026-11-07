import { accountsDeps, type AccountsPagesContext } from '../../../server/accounts/deps'
import { handleSignOut } from '../../../server/accounts/authHandlers'

export const onRequestPost = (ctx: AccountsPagesContext): Promise<Response> => handleSignOut(ctx.request, accountsDeps(ctx.env))
