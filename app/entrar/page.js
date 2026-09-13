import { redirect } from "next/navigation";
import { sessaoValida, DOMINIO_PERMITIDO } from "@/lib/db";
import EntrarCliente from "./EntrarCliente";

export default async function EntrarPage() {
  const usuario = await sessaoValida();
  if (usuario) redirect("/");
  return <EntrarCliente dominioPermitido={DOMINIO_PERMITIDO} />;
}
