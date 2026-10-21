// POST {} -> { token } for the Sumsub WebSDK. Allowed at aal1 so the user can
// verify right after enrolling 2FA without a second prompt.
import { getCaller } from '../_shared/auth.ts'
import { handler, json } from '../_shared/http.ts'
import { sdkAccessToken } from '../_shared/sumsub.ts'

Deno.serve(
  handler(async (req) => {
    const caller = await getCaller(req, { requireMfa: false })
    return json(req, { token: await sdkAccessToken(caller.userId) })
  }),
)
