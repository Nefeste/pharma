// Нажатие не кнопки (Б13, шаг 3; docs/specs/2026-10-vertical-slice.md, «Б13. Доступность и настройки»): строка или ячейка,
// по которой щёлкают, берёт фокус Tab и нажимается Enter или пробелом, как кнопка; роль — для чтения экрана браузером.
import type { KeyboardEvent, MouseEvent } from 'react';

type Fn = (e?: MouseEvent<Element> | KeyboardEvent<Element>) => unknown;

/** Свойства для `<li>`, `<tr>`, `<td>`, `<div>`, по которым щёлкают: щелчок, Enter, пробел, фокус и роль; нечего делать — ничего. */
export function press(fn: Fn | undefined) {
  if (!fn) return {};
  return {
    onClick: (e: MouseEvent<Element>) => void fn(e),
    onKeyDown: (e: KeyboardEvent<Element>) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      void fn(e);
    },
    tabIndex: 0,
    role: 'button' as const,
  };
}
