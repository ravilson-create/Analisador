"use client";
import { useState } from "react";

const C = { azul: "#1B3A8C", vermelho: "#991B1B", vermelhoBg: "#FEE2E2", borda: "#E2E8F0", cinza: "#F4F6FA" };
const inputEstilo = { border: `1px solid ${C.borda}`, borderRadius: 6, padding: "9px 11px", fontSize: 13, width: "100%", boxSizing: "border-box" };

export default function EntrarCliente({ dominioPermitido }) {
  const [modo, setModo] = useState("entrar"); // "entrar" | "cadastro"
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const entrar = async (e) => {
    e.preventDefault();
    setEnviando(true); setErro("");
    try {
      const r = await fetch("/api/auth/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`);
      window.location.href = "/";
    } catch (err) { setErro(err.message); }
    finally { setEnviando(false); }
  };

  const cadastrar = async (e) => {
    e.preventDefault();
    setErro("");
    if (senha !== confirmarSenha) { setErro("As senhas não coincidem."); return; }
    setEnviando(true);
    try {
      const r = await fetch("/api/auth/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, senha }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`);
      window.location.href = "/";
    } catch (err) { setErro(err.message); }
    finally { setEnviando(false); }
  };

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.cinza, padding: 20 }}>
      <div style={{ background: "#fff", border: `1px solid ${C.borda}`, borderRadius: 12, padding: 28, width: "100%", maxWidth: 380 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.azul, margin: "0 0 2px", display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo-mpma.png" alt="MPMA" style={{ height: 30, width: "auto" }} />
          ORÇA VALIDA
        </h1>
        <p style={{ fontSize: 12.5, color: "#666", margin: "0 0 18px" }}>
          {modo === "entrar" ? "Entre com seu e-mail e senha." : `Crie sua conta com um e-mail ${dominioPermitido}.`}
        </p>

        {erro && <p style={{ fontSize: 12.5, color: C.vermelho, background: C.vermelhoBg, padding: "8px 10px", borderRadius: 6, margin: "0 0 12px" }}>⚠ {erro}</p>}

        {modo === "entrar" ? (
          <form onSubmit={entrar}>
            <div style={{ marginBottom: 10 }}>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder={`seu.email${dominioPermitido}`} style={inputEstilo} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
                placeholder="Senha" style={inputEstilo} />
            </div>
            <button type="submit" disabled={enviando}
              style={{ width: "100%", background: C.azul, color: "#fff", border: "none", borderRadius: 6, padding: "10px", fontSize: 13, fontWeight: 700, cursor: enviando ? "not-allowed" : "pointer", opacity: enviando ? 0.6 : 1 }}>
              {enviando ? "Entrando..." : "Entrar"}
            </button>
            <p style={{ textAlign: "center", marginTop: 14 }}>
              <button type="button" onClick={() => { setModo("cadastro"); setErro(""); }}
                style={{ background: "none", border: "none", color: "#666", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                Ainda não tenho conta →
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={cadastrar}>
            <div style={{ marginBottom: 10 }}>
              <input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" style={inputEstilo} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder={`seu.email${dominioPermitido}`} style={inputEstilo} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
                placeholder="Senha (mínimo 8 caracteres)" style={inputEstilo} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <input type="password" required value={confirmarSenha} onChange={(e) => setConfirmarSenha(e.target.value)}
                placeholder="Confirmar senha" style={inputEstilo} />
            </div>
            <button type="submit" disabled={enviando}
              style={{ width: "100%", background: C.azul, color: "#fff", border: "none", borderRadius: 6, padding: "10px", fontSize: 13, fontWeight: 700, cursor: enviando ? "not-allowed" : "pointer", opacity: enviando ? 0.6 : 1 }}>
              {enviando ? "Criando conta..." : "Criar conta"}
            </button>
            <p style={{ textAlign: "center", marginTop: 14 }}>
              <button type="button" onClick={() => { setModo("entrar"); setErro(""); }}
                style={{ background: "none", border: "none", color: "#666", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                ← Já tenho conta
              </button>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
