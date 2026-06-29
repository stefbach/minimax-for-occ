import { MyPatientsClient } from "@/components/desk/MyPatientsClient";
import { MesPatientsPageHeader } from "@/components/desk/MesPatientsPageHeader";

export const dynamic = "force-dynamic";

export default function MesPatientsPage() {
  return (
    <div>
      <MesPatientsPageHeader />
      <MyPatientsClient />
    </div>
  );
}
