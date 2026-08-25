import { SettingsPage } from '@/components/settings-page';

export const metadata = { title: '设置' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <SettingsPage />;
}
