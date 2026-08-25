import { StatsPage } from '@/components/stats-page';

export const metadata = { title: '数据' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <StatsPage />;
}
