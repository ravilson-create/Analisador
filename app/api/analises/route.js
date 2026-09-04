import { sql } from "@/lib/db";

// GET /api/analises — lista as últimas análises automáticas rodadas
// (painel inicial e conferência rápida, sem precisar consultar o banco).
export async function GET(request) {
  try {
    const limite = Math.min(Number(new URL(request.url).searchParams.get("limite")) || 30, 100);
    const rows = await sql`
      SELECT id, os_id, arquivo_nome, resumo, criado_em
      FROM analises_automaticas
      ORDER BY criado_em DESC
      LIMIT ${limite}
    `;
    return Response.json({ analises: rows });
  } catch (e) {
    // Tabela pode ainda não existir (nenhuma análise rodou ainda).
    return Response.json({ analises: [] });
  }
}
