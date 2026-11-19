// Текстовый файл на диск (Б10, шаг 2; геймдизайн, §26.1, «Экспорт»): загрузка файла из окна — ссылка на Blob со
// своим именем. Без сети: файл собирается в окне и уходит в загрузки браузера или в окно сохранения оболочки.
export function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
