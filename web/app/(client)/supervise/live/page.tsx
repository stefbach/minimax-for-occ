import { SuperviseLiveClient } from "@/components/desk/SuperviseLiveClient";
import { SuperviseLivePageHeader } from "@/components/desk/SuperviseLivePageHeader";

export const dynamic = "force-dynamic";

export default function SuperviseLivePage() {
  return (
    <div>
      <SuperviseLivePageHeader />
      <SuperviseLiveClient />
    </div>
  );
}
