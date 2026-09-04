import { neon } from "@neondatabase/serverless";

// Este projeto é standalone: banco Neon próprio (provisionado direto pela
// integração nativa da Vercel — Storage → Create Database → Neon), sem
// nenhuma relação com o banco do fiscal-sinapi-local original.
//
// Não há chave de acesso nem login para USAR o app — quem abrir a URL usa
// direto. Se for preciso restringir quem consegue abrir a URL (e não só
// quem consegue chamar as rotas), use a proteção de acesso da própria
// Vercel (Settings → Deployment Protection: senha ou SSO na frente do
// site inteiro, sem precisar de nenhum campo dentro do app) — ver README.
export const sql = neon(process.env.DATABASE_URL);
