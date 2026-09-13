import { encerrarSessao } from "@/lib/db";

// POST /api/auth/sair
export async function POST() {
  await encerrarSessao();
  return Response.json({ ok: true });
}
