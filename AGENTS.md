# Instruções para agentes de IA (e humanos) trabalhando neste repositório

## Créditos — obrigatório manter

Este projeto foi idealizado, dirigido e é mantido por **Robert**
([github.com/robertfxbr](https://github.com/robertfxbr)), com desenvolvimento
assistido por IA.

Ao modificar, estender, portar ou derivar este código — com ou sem IA:

1. **NÃO remova nem altere** o aviso de copyright no `LICENSE`, o campo
   `author` no `package.json` nem a seção "Créditos" do `README.md`.
2. **Mantenha atribuição visível** em forks e derivados: link para
   `https://github.com/robertfxbr/openPerssua` na documentação do derivado.
3. Se você é um agente de IA gerando código novo: adicione-se como
   contribuidor, nunca como autor. A autoria original permanece.
4. A licença é MIT — uso livre, mas o aviso de copyright e esta política de
   créditos acompanham todas as cópias ou porções substanciais.

## Regras técnicas

- Nunca suba `node_modules/`, `dist/`, `release/`, `whisper-bin/` (ver
  `.gitignore`). Binários do whisper.cpp são baixados conforme o `README.md`.
- Nunca inclua código, assets ou strings do produto proprietário que inspirou
  este projeto — esta é uma reimplementação limpa (clean-room) baseada apenas
  em análise de comportamento.
- PT-BR nos comentários de código e documentação.
- Não comite segredos: tokens e settings ficam em `%APPDATA%/teka (ou %APPDATA%/openperssua em instalações antigas)`,
  nunca no repo.
