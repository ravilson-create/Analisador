import { verificarCredenciais, criarSessao, loginBloqueado, registrarTentativaFalha, limparTentativasLogin } from "@/lib/db";

// POST /api/auth/entrar { email, senha }
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ erro: "Corpo da requisição precisa ser JSON." }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const senha = String(body?.senha || "");
  if (!email || !senha) {
    return Response.json({ erro: "Informe e-mail e senha." }, { status: 400 });
  }

  try {
    const bloqueadoAte = await loginBloqueado(email);
    if (bloqueadoAte) {
      return Response.json({
        erro: `Muitas tentativas com esse e-mail. Tente novamente após ${bloqueadoAte.toLocaleString("pt-BR")}.`,
      }, { status: 429 });
    }

    const usuario = await verificarCredenciais(email, senha);
    if (!usuario) {
      await registrarTentativaFalha(email);
      return Response.json({ erro: "E-mail ou senha incorretos." }, { status: 401 });
    }

    await limparTentativasLogin(email);
    await criarSessao(usuario);
    return Response.json({ usuario });
  } catch (e) {
    console.error("[auth/entrar POST]", e);
    return Response.json({ erro: "Não foi possível entrar. Tente novamente." }, { status: 500 });
  }
}
