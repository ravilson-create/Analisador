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

// DELETE /api/analises?id=123 — apaga uma análise (e seu resultado
// processado) do banco. Existe para permitir limpar "Análises recentes" de
// tempos em tempos e não deixar a tabela crescer sem limite — não há
// exclusão automática por idade/quantidade, é sempre uma ação manual.
export async function DELETE(request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ erro: "id obrigatório" }, { status: 400 });
    await sql`DELETE FROM analises_automaticas WHERE id = ${id}`;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erro: e.message || "Falha ao excluir a análise." }, { status: 500 });
  }
}
