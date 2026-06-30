import { SuperviseInboundClient } from "@/components/desk/SuperviseInboundClient";
import { SuperviseLivePageHeader } from "@/components/desk/SuperviseLivePageHeader";

export const dynamic = "force-dynamic";

export default function SuperviseInboundPage() {
  return (
    <div>
      <SuperviseLivePageHeader />
      <SuperviseInboundClient />
    </div>
  );
}
