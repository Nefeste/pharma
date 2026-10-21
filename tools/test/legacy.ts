// Прежний сценарий прототипа (до Б2в, версия 0.0.27) — опора тестов механики движка: восемь заданий на серию раз в
// неделю, разовые заказы поставщикам на старте, запас на пять серий, прежний штат, спрос покупателей и запас пуансонов,
// один продукт, без коллег планирования и снабжения. Баланс игры (content/scenarios/proto.yaml) меняется от части к части, механика — нет: эти тесты
// проверяют её на знакомой жизни завода. Количества — в единицах движка: масса — мг, штуки — штуки.
import { db } from '../../src/content';
import type { ContentDb, Id } from '../../src/content/types';

const kg = (x: number) => x * 1_000_000;
const RCP = 'rcp.paracetamol500.wet.v1';
const N20 = 'sku.paracetamol500.n20';
const N10 = 'sku.paracetamol500.n10';
const row = (role: Id, shift: Id, n: number, skill = 3) => ({ role, shift, skill, n });

export const legacy: ContentDb = structuredClone(db);
const sc = legacy.scenarios['scn.proto'];
// без плана выпуска обещанного объёма в рамочных договорах нет (Б3г): прайс — как цена договора, деньги — прежние
sc.partners = { ...sc.partners, markup: 0 };
sc.staff = [
  row('role.storekeeper', 'shift.day', 2),
  row('role.driver', 'shift.day', 2),
  row('role.sampler', 'shift.day', 1),
  row('role.analyst', 'shift.day', 3),
  row('role.qc-head', 'shift.day', 1, 4),
  row('role.qa', 'shift.day', 1),
  row('role.qp', 'shift.day', 1, 4),
  row('role.operator', 'shift.a', 3),
  row('role.operator', 'shift.b', 3),
  row('role.master', 'shift.a', 1, 4),
  row('role.master', 'shift.b', 1),
  row('role.line-operator', 'shift.a', 2),
  row('role.line-operator', 'shift.b', 2),
  row('role.packer', 'shift.a', 2),
  row('role.packer', 'shift.b', 2),
  row('role.mechanic', 'shift.a', 1),
  row('role.mechanic', 'shift.b', 1),
  row('role.setter', 'shift.day', 1),
];
sc.orders = [
  { supplier: 'sup.exc', lines: [{ material: 'mat.exc.starch', qty: kg(500) }, { material: 'mat.exc.mcc', qty: kg(200) }] },
  {
    supplier: 'sup.pack',
    lines: [
      { material: 'mat.pk.carton-n20', qty: 40000 },
      { material: 'mat.pk.carton-n10', qty: 20000 },
      { material: 'mat.pk.leaflet', qty: 100000 },
      { material: 'mat.pk.case', qty: 500 },
    ],
  },
  { supplier: 'sup.api', lines: [{ material: 'mat.api.paracetamol', qty: kg(1000) }] },
];
sc.batches = [1, 8, 15, 22, 29, 36, 43, 50].map((day, i) => ({ recipe: RCP, day, sku: [N20, N10, N20, N20, N10, N20, N10, N20][i] }));
sc.stock = [
  { material: 'mat.api.paracetamol', qty: kg(600) },
  { material: 'mat.exc.starch', qty: kg(250) },
  { material: 'mat.exc.povidone', qty: kg(75) },
  { material: 'mat.exc.mcc', qty: kg(100) },
  { material: 'mat.exc.mgst', qty: kg(20) },
  { material: 'mat.pk.pvc', qty: kg(250) },
  { material: 'mat.pk.alu', qty: kg(200) },
  { material: 'mat.pk.carton-n10', qty: 40000 },
  { material: 'mat.pk.carton-n20', qty: 20000 },
  { material: 'mat.pk.leaflet', qty: 50000 },
  { material: 'mat.pk.case', qty: 500 },
];
delete sc.plan;
delete sc.supply;
legacy.customers['cus.national'].demand = { [N20]: 600, [N10]: 300 };
legacy.customers['cus.regional'].demand = { [N20]: 300, [N10]: 200 };
// неснижаемый запас пуансонов — прежний, до второго продукта (Б2б): резерва нет, заказ — когда кончились
legacy.spares['spare.punches'].stock = { min: 0, max: 1 };
// обучения в прежней жизни завода нет (Б3б): записи на старте свежие — сроки кончатся через год, — новой редакции уборки
// нет; механику обучения проверяют свои тесты на базе игры
sc.training = { ...sc.training, spread: 0 };
delete legacy.sops['sop.cleaning-r2'];
