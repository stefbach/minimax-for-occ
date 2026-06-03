import { redirect } from "next/navigation";

// Live Monitor moved into the Tableau d'analyse as a tab. Keep this redirect
// so old bookmarks / sidebar references still land on the right view.
export default function LiveRedirect() {
  redirect("/dashboard?tab=live");
}
