import { SearchX } from 'lucide-react';
import { HomeButton, StatusScreen } from '@/components/StatusScreen';

export default function NotFound() {
  return (
    <StatusScreen icon={<SearchX />} title="Page not found" actions={<HomeButton />}>
      There’s nothing at this address. Your sessions are on the home page.
    </StatusScreen>
  );
}
