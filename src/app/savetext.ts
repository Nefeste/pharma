// Текстовый файл на диск (Б10, шаг 2; геймдизайн, §26.1, «Экспорт»): загрузка файла из окна — ссылка на Blob со
// своим именем. Без сети: файл собирается в окне и уходит в загрузки браузера или в окно сохранения оболочки.
export function saveText(name: string, text: string) {
  saveBlob(name, new Blob([text], { type: 'text/plain;charset=utf-8' }));
}

/** Файл на диск из окна — та же ссылка на Blob: текст хроники, снимок кадра (Б11, шаг 2). */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Имя снимка кадра (Б11, шаг 2): время завода, не компьютера — `pharma-2027-09-01-0800.png`; только латиница, цифры и дефис. */
export function shotName(y: number, m: number, d: number, sec: number): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `pharma-${y}-${two(m)}-${two(d)}-${two(Math.floor(sec / 3600))}${two(Math.floor((sec % 3600) / 60))}.png`;
}
