import { BillingClient } from "@/components/admin/BillingClient";

export const dynamic = "force-dynamic";

export default function AdminBillingPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Facturation</h1>
          <div className="subtitle">
            Plan, consommation du mois et historique des factures.
          </div>
        </div>
      </div>
      <BillingClient />
    </>
  );
}
