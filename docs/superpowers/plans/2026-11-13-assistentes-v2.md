# Assistentes v2 — plano de implementação

Objetivo: executar os sete itens solicitados no Teka, na branch `feat/assistentes-v2`, com um commit por item.

Arquitetura: manter presets imutáveis; contexto e preferências ficam em settings por id. Extrair anexos no renderer, armazenar apenas texto e inserir dados delimitados nos prompts. Usar builders puros e testes Node sem chamar modelos.

Restrições: clean-room, PT-BR, preservar autoria e créditos, versão e dependências da casca; sem instalador, publicação ou encerramento de processos do usuário.

1. [x] Contexto: módulo de limites/normalização, editor de texto e anexos, PDF.js no renderer; encaminhar a todos os prompts aplicáveis e histórico. Testar truncamento, dados hostis e extração de PDF; build e commit.
2. [x] Certeza: preferência por id, regra fixa para resposta/tela/ao vivo, perfil global também na resposta manual. Testar desligado/ligado e entrevista; build e commit.
3. [x] Instruções: preservar `instructions`; somar campos por uso, editor recolhido e perguntas após resposta. Testar isolamento entre usos e formato antigo; build e commit.
4. [x] Pensar mais: configuração global; encaminhar somente a perguntas manuais. OAuth com recuo e CLIs com detecção de suporte. Testar roteamento/recuo sem rede; build e commit.
5. [x] Escuta longa: configuração global, relógio de 30 minutos, aviso de 60 segundos, pausa que preserva sessão. Testar relógio com tempo simulado; build e commit.
6. [x] Categorias: categorias dos presets, edição livre com sugestões, busca e contagens. Verificar formato antigo e filtros; build e commit.
7. [x] Portabilidade: JSON versionado apenas de próprios, validação estrita, limites, ids sem conflito, contexto e preferências. Testar round-trip, entradas inválidas, colisões e chaves hostis; build e commit.

Revisão final: sete commits numerados, árvore limpa, sem artefatos ignorados ou alterações em autoria/versão/créditos. Verificação visual em instância isolada se disponível, sem acessar dados do app proprietário nem executar provedores pagos.

Verificação concluída: build em cada item, oito scripts locais e revisão independente. Detalhes e limites em `docs/assistentes-v2.md`.
