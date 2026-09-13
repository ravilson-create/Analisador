import { sql, garantirTabelasAuth, emailPermitido, DOMINIO_PERMITIDO, criarSessao } from "@/lib/db";

// POST /api/auth/cadastro { nome, email, senha }
// Cadastro público, restrito ao domínio institucional (DOMINIO_PERMITIDO).
// A primeira conta criada (tabela vazia) vira administrador automaticamente
// — não há tela de convite/promoção; contas seguintes entram como usuário
// comum. Termina logando quem se cadastrou (mesmo padrão do login).
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ erro: "Corpo da requisição precisa ser JSON." }, { status: 400 });
  }

  const nome = String(body?.nome || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const senha = String(body?.senha || "");

  if (!nome || !email || !senha) {
    return Response.json({ erro: "Preencha nome, e-mail e senha." }, { status: 400 });
  }
  if (!emailPermitido(email)) {
    return Response.json({ erro: `Cadastro permitido apenas para e-mails ${DOMINIO_PERMITIDO}.` }, { status: 400 });
  }
  if (senha.length < 8) {
    return Response.json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
  }

  try {
    await garantirTabelasAuth();
    const [{ total }] = await sql`SELECT count(*)::int AS total FROM usuarios`;
    const perfil = total === 0 ? "admin" : "usuario";

    const [usuario] = await sql`
      INSERT INTO usuarios (email, senha_hash, nome, perfil)
      VALUES (${email}, crypt(${senha}, gen_salt('bf')), ${nome}, ${perfil})
      RETURNING id, email, nome, perfil
    `;
    await criarSessao(usuario);
    return Response.json({ usuario }, { status: 201 });
  } catch (e) {
    if (String(e.message).includes("usuarios_email_key")) {
      return Response.json({ erro: "Já existe uma conta com esse e-mail." }, { status: 409 });
    }
    console.error("[auth/cadastro POST]", e);
    return Response.json({ erro: "Não foi possível concluir o cadastro. Tente novamente." }, { status: 500 });
  }
}
