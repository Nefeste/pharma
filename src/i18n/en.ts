// Строки игры по-английски — того же вида, что ru.ts (проверяет tsc).
import type { Strings } from './ru';

export const en: Strings = {
  app: {
    title: 'Farmzavod',
    loading: 'Loading…',
    error: 'Error',
    stage: 'Prototype, part 0: clock, calculation thread and view',
  },
  date: {
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    full: (d: number, month: string, y: number) => `${month} ${d}, ${y}`,
  },
  top: {
    day: (n: number) => `Day ${n}`,
    pause: 'Pause',
    speed: (k: number) => `×${k}`,
    speedHint: (what: string) => `Speed: ${what} per second`,
    perSecond: ['1 minute', '5 minutes', '20 minutes', '2 hours'],
    morning: 'Until morning',
    morningHint: 'Fast-forward to the 08:00 meeting',
    lag: (min: number) => `calculation is ${min} min behind`,
  },
  notices: {
    morning: (day: number) => `08:00 meeting: day ${day} has begun`,
    ordered: 'Purchase order placed',
    truck: 'A truck is at the receiving dock',
    lotReleased: 'Lot released: all tests within specification',
    lotRejected: 'Lot rejected: out-of-specification result',
    batchBulk: 'Batch made: bulk in quarantine',
    deviation: 'Production deviation',
    refused: 'The command was refused',
  },
  debug: {
    title: 'Debug',
    fps: (n: number) => `${n} fps`,
    cpu: (ms: string) => `CPU ${ms} ms`,
    gpu: (ms: string) => `GPU ${ms} ms`,
    quality: 'Quality',
    qualities: { low: 'low', medium: 'medium', high: 'high' },
  },
};
