export const metadata = {
  title: "Análise Automática SINAPI — MPMA",
  description: "Serviço standalone que analisa planilhas de medição (PDF) contra SINAPI/ORSE, disparado pelo Tá na Mão.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "'Inter','Segoe UI',sans-serif", background: "#F4F6FA", color: "#1A202C" }}>
        {children}
      </body>
    </html>
  );
}
