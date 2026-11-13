import React from 'react';

// Marca do Teka: um balão de fala com três barras de voz dentro.
// "Escuta a conversa e sopra a resposta" — desenho próprio do projeto.
export function TekaMark({ size = 22 }) {
  return (
    <svg className="teka-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--mint)" />
      <path
        d="M9 9.5h14a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-6.2l-4.3 3.4v-3.4H9A2.5 2.5 0 0 1 6.5 19v-7A2.5 2.5 0 0 1 9 9.5z"
        fill="var(--accent-ink)"
      />
      <rect x="11.2" y="13.2" width="2" height="4.6" rx="1" fill="var(--mint)" />
      <rect x="15" y="11.8" width="2" height="7.4" rx="1" fill="var(--mint)" />
      <rect x="18.8" y="13.9" width="2" height="3.2" rx="1" fill="var(--mint)" />
    </svg>
  );
}
