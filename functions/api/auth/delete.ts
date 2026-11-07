import { accountsDeps, type AccountsPagesContext } from '../../../server/accounts/deps'
import { handleDeleteAccount } from '../../../server/accounts/authHandlers'

export const onRequestPost = (ctx: AccountsPagesContext): Promise<Response> => handleDeleteAccount(ctx.request, accountsDeps(ctx.env))
