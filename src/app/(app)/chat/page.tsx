import { ChatPage } from '@/components/chat-page';

export const metadata = { title: 'AI 对话' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <ChatPage />;
}
