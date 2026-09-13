import { redirect } from "next/navigation";
import { sessaoValida } from "@/lib/db";
import AppCliente from "./AppCliente";

export default async function Page() {
  const usuario = await sessaoValida();
  if (!usuario) redirect("/entrar");
  return <AppCliente usuario={usuario} />;
}
