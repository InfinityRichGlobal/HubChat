import { getRuntimeSetting } from '@/server/settings/service';
import { ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const mode = (await getRuntimeSetting('AVATAR_DISPLAY_MODE')) ?? 'platform';
    const originBadge = (await getRuntimeSetting('AVATAR_ORIGIN_BADGE')) ?? 'off';
    return ok({
      mode: mode === 'real_profile' ? 'real_profile' : 'platform',
      showBadge: originBadge === 'on',
    });
  } catch {
    return ok({
      mode: 'platform',
      showBadge: false,
    });
  }
}
