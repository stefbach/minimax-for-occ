import { DeskWorkstation } from "@/components/desk/DeskWorkstation";
import { DeskPageHeader } from "@/components/desk/DeskPageHeader";

export const dynamic = "force-dynamic";

export default function DeskPage() {
  return (
    <div>
      <DeskPageHeader />
      <DeskWorkstation />
    </div>
  );
}
