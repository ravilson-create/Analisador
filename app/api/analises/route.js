import { sql, sessaoValida, ehAdmin } from "@/lib/db";

// GET /api/analises — lista as últimas análises (painel inicial). Exige
// login; devolve as públicas (usuario_id NULL, disparadas pelo Apps
// Script) + as do próprio usuário — ou todas, se for administrador
// (supervisão). O nome/e-mail de quem rodou só é incluído para o admin.
export async function GET(request) {
  const usuario = await sessaoValida();
  if (!usuario) return Response.json({ erro: "Não autenticado." }, { status: 401 });

  try {
    const limite = Math.min(Number(new URL(request.url).searchParams.get("limite")) || 30, 100);
    const admin = ehAdmin(usuario);
    const rows = admin
      ? await sql`
          SELECT a.id, a.os_id, a.arquivo_nome, a.resumo, a.criado_em, a.usuario_id,
                 u.nome AS usuario_nome, u.email AS usuario_email
          FROM analises_automaticas a
          LEFT JOIN usuarios u ON u.id = a.usuario_id
          ORDER BY a.criado_em DESC
          LIMIT ${limite}
        `
      : await sql`
          SELECT id, os_id, arquivo_nome, resumo, criado_em, usuario_id
          FROM analises_automaticas
          WHERE usuario_id IS NULL OR usuario_id = ${usuario.id}
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
// processado) do banco. Só quem rodou a análise ou o administrador pode
// excluir; uma análise pública (usuario_id NULL) só o admin apaga. Existe
// para permitir limpar "Análises recentes" de tempos em tempos — não há
// exclusão automática por idade/quantidade, é sempre uma ação manual.
export async function DELETE(request) {
  const usuario = await sessaoValida();
  if (!usuario) return Response.json({ erro: "Não autenticado." }, { status: 401 });

  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ erro: "id obrigatório" }, { status: 400 });

    const [analise] = await sql`SELECT usuario_id FROM analises_automaticas WHERE id = ${id}`;
    if (!analise) return Response.json({ erro: "Análise não encontrada." }, { status: 404 });

    const admin = ehAdmin(usuario);
    const dono = analise.usuario_id === usuario.id;
    if (!admin && (analise.usuario_id === null || !dono)) {
      return Response.json({ erro: "Você não tem permissão para excluir esta análise." }, { status: 403 });
    }

    await sql`DELETE FROM analises_automaticas WHERE id = ${id}`;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erro: e.message || "Falha ao excluir a análise." }, { status: 500 });
  }
}
