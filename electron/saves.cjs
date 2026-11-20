// из bolnitsa: electron/saves.cjs @ 15a7ad6
// Папка сохранений в Electron (docs/specs/2026-10-vertical-slice.md, «Сохранения»): `<папка игры пользователя>/saves` —
// на Windows `%APPDATA%\pharma\saves`. Страница называет только ячейку (`auto-1.save`, `manual-3.meta.json`) — путей нет, и
// выйти за папку нельзя. Запись — во временный файл и подмена: файл целиком или прежний.
const fs = require('node:fs');
const path = require('node:path');

/** Имя файла ячейки: латиница, цифры, дефис; `.save` или `.meta.json`. */
const NAME = /^[a-z0-9-]+\.(save|meta\.json)$/;

function check(name) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`bad save name: ${String(name)}`);
  return name;
}

/** Пять действий над папкой `dir`; её нет — создаётся при первой записи. */
function savesIn(dir) {
  const at = name => path.join(dir, check(name));
  return {
    async read(name) {
      try {
        return await fs.promises.readFile(at(name));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async write(name, bytes) {
      await fs.promises.mkdir(dir, { recursive: true });
      const file = at(name);
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, Buffer.from(bytes));
      // переименование поверх — и на Windows: libuv делает это с заменой
      await fs.promises.rename(tmp, file);
    },
    async move(from, to) {
      try {
        await fs.promises.rename(at(from), at(to));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    },
    async remove(name) {
      await fs.promises.rm(at(name), { force: true });
    },
    async list() {
      try {
        return (await fs.promises.readdir(dir)).filter(n => NAME.test(n));
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
  };
}

module.exports = { savesIn, NAME };
