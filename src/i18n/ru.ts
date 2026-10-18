// Строки игры по-русски (устав, docs/05-rules.md: все строки для игрока — здесь). Английский — en.ts, того же вида.
import type { ZoneKind } from '../content/types';
import { pluralRu } from './plural';

export const ru = {
  app: {
    title: 'Фармзавод',
    loading: 'Загрузка…',
    error: 'Ошибка',
    stage: 'Прототип, часть 2: 3D-вид завода',
  },
  date: {
    /** родительный падеж: «1 сентября 2027» */
    months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    weekdays: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
    full: (d: number, month: string, y: number) => `${d} ${month} ${y}`,
  },
  top: {
    day: (n: number) => `Сутки ${n}`,
    pause: 'Пауза',
    speed: (k: number) => `×${k}`,
    speedHint: (what: string) => `Скорость: ${what} за секунду`,
    perSecond: ['1 минута', '5 минут', '20 минут', '2 часа'],
    morning: 'До утра',
    morningHint: 'Промотать до планёрки в 08:00',
    live: '1:1',
    liveHint: 'Живое время: секунда за секунду, всё движется как в жизни',
    lag: (min: number) => `расчёт отстаёт на ${min} ${pluralRu(min, 'минуту', 'минуты', 'минут')}`,
  },
  notices: {
    morning: (day: number) => `Планёрка в 08:00: начались сутки ${day}`,
    ordered: 'Заказ поставщику принят',
    truck: 'Фура у рампы приёмки',
    lotReleased: 'Партия разрешена: все испытания в пределах',
    lotRejected: 'Партия отклонена: результат вне спецификации',
    batchBulk: 'Серия сделана: балк в карантине',
    batchPacked: 'Серия упакована: готовая продукция в карантине',
    batchReleased: 'Уполномоченное лицо выпустило серию',
    batchRejected: 'Уполномоченное лицо отклонило серию',
    batchHeld: 'Уполномоченное лицо держит серию: открыты отклонения',
    deviation: 'Отклонение на производстве',
    shipped: 'Фура покупателя ушла с отгрузкой',
    lateOrder: 'Заказ покупателя: недопоставка или опоздание',
    cashLow: 'Касса ниже предела кредитной линии',
    failure: 'Отказ узла машины: ждёт ремонта',
    repaired: 'Узел машины починен или заменён',
    refused: 'Команда не выполнена',
  },
  view: {
    walls: 'Стены',
    wallsFull: 'Целые',
    wallsCut: 'Срез',
    wallsDown: 'Вниз',
  },
  /** названия зон склада — краской на полу (docs/specs/2026-10-view.md, 2г) */
  zones: {
    receiving: 'Приёмка',
    quarantine: 'Карантин',
    sampling: 'Отбор проб',
    staging: 'Комплектация',
    palletizing: 'Паллетирование',
    cold: 'Холод',
    rejected: 'Отклонённое',
    fgQuarantine: 'Карантин ГП',
    shipping: 'Экспедиция',
  } as Record<ZoneKind, string>,
  /** табличка помещения производства: статус чистоты, серия и стадия (GMP ЕАЭС, ч. I, пп. 5.12, 5.13) */
  room: {
    status: { clean: 'Чисто', busy: 'Занято', dirty: 'Грязно' },
    batch: (code: string) => `Серия ${code}`,
  },
  /** стадии технологической карты — по их коду в записи карты */
  stages: {
    dispense: 'Отвешивание',
    granulate: 'Грануляция',
    dry: 'Сушка',
    mill: 'Калибровка',
    blend: 'Опудривание',
    compress: 'Таблетирование',
  } as Record<string, string>,
  debug: {
    title: 'Отладка',
    fps: (n: number) => `${n} к/с`,
    cpu: (ms: string) => `процессор ${ms} мс`,
    gpu: (ms: string) => `видеокарта ${ms} мс`,
    quality: 'Качество',
    qualities: { low: 'низкое', medium: 'среднее', high: 'высокое' },
    bench: 'Авто-бенч',
    benchUncapped: 'Авто-бенч без vsync (перезапуск)',
    benchRunning: 'Авто-бенч идёт…',
    benchCell: (q: string, cam: string, phase: string) => `Авто-бенч: ${q}, ${cam} — ${phase}`,
    warm: 'прогрев',
    measure: 'замер',
    shots: 'Авто-бенч: снимки…',
    done: (path: string) => `Готово. Итог сохранён: ${path} (и снимки рядом)`,
    download: 'Готово — скачать итог (JSON)',
    overviewCam: 'общий план',
    closeCam: 'крупный план',
  },
  /** снимки авто-бенча */
  shots: { overview: 'общий план, день', racks: 'склад и стеллажи', line: 'упаковочная линия', machine: 'блистерная машина' },
};

export type Strings = typeof ru;
